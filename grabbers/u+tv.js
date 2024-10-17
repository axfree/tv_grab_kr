#!/usr/bin/env node

'use strict';

var request   = require("co-request");
var $         = require('cheerio');
var moment    = require('moment-timezone');
var iconv     = require('iconv-lite');

// channelGroups:
//   지상파/종편
//   스포츠/취미
//   영화
//   뉴스/경제
//   교양/다큐
//   여성/오락
//   어린이/교육
//   홈쇼핑
//   공공/종교

const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';

const gnreCds = {
    '00': '영화',
    '02': '만화',
    '03': '드라마',
    '05': '스포츠',
    '06': '교육',
    '08': '연예/오락',
    '09': '공연/음악',
    '11': '다큐',
    '12': '뉴스/정보',
    '13': '라이프',
    '14': '종교',
    '18': '가요/국내',
    '19': '팝',
    '20': '록',
    '21': '종합',
    '22': '재즈',
    '23': '클래식',
    '24': '무드',
    '25': '라디오 방송',
    '26': '시대',
    '28': '업소용',
    '29': '테마',
    '30': 'Shop',
    '31': '기타',
};

function *grab(config, argv) {
    var today = moment.tz('Asia/Seoul').startOf('day');

    // https://www.lguplus.com/iptv/channel-guide
    var res = yield request.get(`https://www.lguplus.com/uhdc/fo/prdv/chnlgid/v1/tv-schedule-list`, {
        qs: {
            // brdCntrTvChnlBrdDt: today.format('YYYYMMDD'),   // '20241018'
            urcBrdCntrTvChnlId: '',
            urcBrdCntrTvChnlGnreCd: '00'
        },
        json: true
    });

    var channelGroups = res.body.brdGnreDtoList
                            .filter(cg => !!cg.urcBrdCntrTvChnlGnreCd); // filter out "전체채널"
    // [
    //   {
    //     checkYn: 'Y',
    //     urcBrdCntrTvChnlGnreCd: '00',
    //     urcBrdCntrTvChnlGnreNm: '지상파/종편'
    //   },

    if (argv.listChannelGroup) {
        channelGroups.forEach(cg => console.log(`u+tv:${cg.urcBrdCntrTvChnlGnreNm}`));
        return;
    }

    var channels = {};

    for (var channel of res.body.brdCntrTvChnlIDtoList) {
        // [
        //     {
        //       urcBrdCntrTvChnlId: '561',
        //       urcBrdCntrTvChnlNo: '5',
        //       urcBrdCntrTvChnlNm: 'TJB[5]',
        //       urcBrdCntrTvChnlGnreCd: '00',
        //       urcBrdCntrTvChnlDscr: 'TJB'
        //     },
        var channelGroup = channelGroups.find(cg => cg.urcBrdCntrTvChnlGnreCd == channel.urcBrdCntrTvChnlGnreCd).urcBrdCntrTvChnlGnreNm;
        var channelName = channel.urcBrdCntrTvChnlNm
                            .replace(/\[\d+\]$/, '')   // TJB[5] => TJB
                            .replace(/-Full HD$/, '')
                            .replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1')
                            .replace(/^MBC(경남)/, 'MBC $1')
                            .replace(/^(진주)MBC/, 'MBC $1');
        var channelNumber = channel.urcBrdCntrTvChnlNo;
        var channelFullName = `u+tv:${channelGroup}:${channelName}`;

        if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
            continue;

        if (channels[channelName]) {
            // console.log(channelName, 'skip');
            continue;
        }
        if (argv.debug)
            console.log(channelFullName);

        var programs = [];
        var date = moment(today);
        for (var d = 0; d < Math.min(3, config.days); d++) {
            var res = yield request.get(`https://www.lguplus.com/uhdc/fo/prdv/chnlgid/v1/tv-schedule-list`, {
                qs: {
                    brdCntrTvChnlBrdDt: date.format('YYYYMMDD'),            // '20241018'
                    urcBrdCntrTvChnlId: channel.urcBrdCntrTvChnlId,         // '561'
                    urcBrdCntrTvChnlGnreCd: channel.urcBrdCntrTvChnlGnreCd, // '00'
                },
                json: true
            });

            for (var r of res.body.brdCntTvSchIDtoList) {
                // [{
                //     brdCntTvSchIDtoList: null,
                //     brdGnreDtoList: null,
                //     brdCntrTvChnlIDtoList: null,
                //     urcBrdCntrTvChnlGnreCd: null,
                //     urcBrdCntrTvChnlNo: null,
                //     urcBrdCntrTvChnlNm: 'SBS',
                //     urcBrdCntrTvChnlId: '504',
                //     brdCntrTvChnlBrdDt: '20241017',
                //     epgStrtTme: '00:50:00',
                //     urcBrdCntrTvSchdGnreCd: '12',
                //     brdPgmTitNm: '세상에서 가장 아름다운 여행 스페셜',
                //     brdPgmDscr: '장애나 희귀병으로 고통받는 아이들과, 가난 때문에 치료를 포기 해야만 하는 위기에 처한 가정을 찾아가, 전문의, 심리학자, 상담사, 건축설계사 등 국내 최고의 전문가 그룹이 장애를 앓고 있는 어린이와 그 가..',
                //     brdWtchAgeGrdCd: '0',
                //     brdPgmRsolNm: '4K',
                //     subtBrdYn: 'Y',
                //     explBrdYn: 'Y',
                //     silaBrdYn: 'N',
                //     dataInpsId: null,
                //     dataInptDttm: null,
                //     dataInptPgmId: null,
                //     dataMfpnId: null,
                //     dataUpdDttm: null,
                //     dataUpdPgmId: null
                //  },
                var program = {};

                program.start = moment(r.brdCntrTvChnlBrdDt + r.epgStrtTme + '+0900', 'YYYYMMDDHH:mm:ssZ');

                // 역전다방 (11회)
                // 생방송 투데이<재>
                // 모닝와이드 (1부)
                // UHD 한국 100경 (43회)<재>
                // 지식채널e(1) [[우리가 사는 세상] 1부 홀로세의 종말]
                // EBS 비즈니스 리뷰 [최원석의 온라인을 뛰어넘는 가치 있는 오프라인 - 4부 팝업 스토어가 쏘..

                var title = r.brdPgmTitNm;
                if (title.endsWith('..'))
                    title = fixUnbalancedParenthesis(r.brdPgmTitNm, {});

                var m = title.match(/^(.*?)(?: \[(.*)\])?(?: ?\((\d+회)\))?(<재>)?$/);
                if (!m)
                    throw new Error(`title parse failed: ch=${channelName}, title="${r.brdPgmTitNm}"`);

                program.title = m[1];
                if (m[2])
                    program.subtitle = m[2];
                if (m[3])
                    program.episode = m[3];
                if (m[4])
                    program.rebroadcast = true;

                if (r.brdPgmDscr)
                    program.desc = r.brdPgmDscr;

                if (r.urcBrdCntrTvSchdGnreCd in gnreCds)
                    program.category = gnreCds[r.urcBrdCntrTvSchdGnreCd];

                if (r.brdWtchAgeGrdCd != '0')
                    program.rating = [ 7, 12, 15, 19 ][+r.brdWtchAgeGrdCd - 1];

                programs.push(program);
            }
        }

        yield delay(200);

        channels[channelName] = {
            // icon: '',
            number: channelNumber,
            group: channelGroup,
            programs: programs
        };
    }

    return channels;
}

const openerSet = '([{<';
const closerSet = ')]}>';

function fixUnbalancedParenthesis(title, options) {
    // options.prependMissingOpener
    // options.removeUnbalancedOpener
    var output = [];
    var openers = [];
    for (var c of title) {
        var openerIdx = openerSet.indexOf(c);
        if (openerIdx >= 0) {
            openers.push(openerIdx);
            output.push(c);
        }
        else {
            var closerIdx = closerSet.indexOf(c);
            if (closerIdx >= 0) {
                var openerFound = false;
                while (openers.length > 0) {
                    var openerIdx = openers.pop();
                    if (openerIdx == closerIdx) {
                        output.push(c);
                        openerFound = true;
                        break;
                    }
                    output.push(closerSet[openerIdx])
                }
                if (!openerFound) {
                    if (options.prependMissingOpener)
                        output = [ openerSet[closerIdx], ...output, c ];
                }
            }
            else
                output.push(c);
        }
    }

    if (options.removeUnbalancedOpener) {
        openers.forEach(idx => {
            output.splice(output.indexOf(openerSet[idx]), 1);
        });
    }
    else
        openers.reverse().forEach(idx => output.push(closerSet[idx]));

    return output.join('');
}

module.exports = {
    name: 'u+tv',
    grab: grab
}

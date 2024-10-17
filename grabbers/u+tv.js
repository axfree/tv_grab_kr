#!/usr/bin/env node

'use strict';

var request   = require("co-request");
var $         = require('cheerio');
var moment    = require('moment-timezone');
var iconv     = require('iconv-lite');

// channelGroups:
//   지상파
//   스포츠/취미
//   영화
//   뉴스/경제
//   교양/다큐
//   여성/오락
//   어린이/교육
//   홈쇼핑
//   공공/종교

var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';

function *grab(config, argv) {
    var res = yield request.get('https://www.uplus.co.kr/css/chgi/chgi/RetrieveTvContentsMFamily.hpi', {
        headers: {
            'User-Agent': ua,
        },
        encoding: null,
    });

    var channels = {};
    var channelGroupsAs = $('a[href="#CHANNEL"]', iconv.decode(res.body, 'cp949'));
    for (var a of channelGroupsAs.get()) {
        var channelGroup = $(a).text();
        if (argv.listChannelGroup) {
            console.log(`tvG:${channelGroup}`);
            continue;
        }

        var m = $(a).attr('onclick').match(/'(\d+)','(\d+)','(\d+)'/);
        var res = yield request.post('https://www.uplus.co.kr/css/chgi/chgi/RetrieveTvChannel.hpi', {
            headers: {
                'User-Agent': ua,
            },
            encoding: null,
            form: {
                code: m[2],
                category: m[1]
            },
        });

        var channelAs = $('.tvcategory li > a', iconv.decode(res.body, 'cp949'));
        for (var a of channelAs.get()) {
            var m = $(a).text().match(/(.*)\(Ch\.(\d+)\)/);
            var channelName = m[1].replace(/-Full HD$/, '')
                                  .replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1')
                                  .replace(/^MBC(경남)/, 'MBC $1')
                                  .replace(/^(진주)MBC/, 'MBC $1');
            var channelNumber = m[2];
            var channelFullName = `tvG:${channelGroup}:${channelName}`;
            var channelCode = $(a).attr('onclick').match(/'(\d+)','(\d+)'/) [1];

            if (argv.listChannels) {
                console.log(`tvG:${channelGroup}:${channelName}`);
                continue;
            }

            if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
                continue;

            if (channels[channelName]) {
                // console.log(channelName, 'skip');
                continue;
            }
            if (argv.debug)
                console.log(channelFullName);

            var programs = [];
            var date = moment.tz('Asia/Seoul').startOf('day');
            do {
                var res = yield request.post('https://www.uplus.co.kr/css/chgi/chgi/RetrieveTvSchedule.hpi', {
                    headers: {
                        'User-Agent': ua,
                    },
                    encoding: null,
                    form: {
                        chnlCd: channelCode,
                        evntCmpYmd: date.format('YYYYMMDD')
                    },
                });
                var body = iconv.decode(res.body, 'cp949').replace(/<재>/g, `&lt;재&gt;`);
                var nextLink = $('a.next', body);
                var trs = $('tbody > tr', body);
                trs.each((idx, tr) => {
                    var startTime = $('td:nth-child(1)', tr).text();    // 23:10
                    var title = $('td:nth-child(2)', tr).contents().first().text().trim();
                    var rating = $('.cte_all', tr).text();
                    var program = {
                        start: moment(date.format('YYYYMMDD') + startTime + '+0900', 'YYYYMMDDHH:mmZ'),
                        category: $('td:nth-child(3)', tr).text().trim(),
                        rating: rating == 'All' ? 0 : +rating
                    }

                    // [카톨릭 명화극장 [교황 요한 23세 2-1]
                    // <재> [카톨릭 명화극장 [교황 요한 23세 2-1]
                    title = fixUnbalancedParenthesis(title, { removeUnbalancedOpener: true });

                    // <재> TV 동물농장
                    // <재> 녹두꽃 (1회)
                    // 모닝와이드 (3부)
                    // 강남스캔들 (111회)
                    // 빅이슈 [최종] (32회)
                    // [삼성:키움] 2019 프로야구
                    // <재> 걸어서 세계속으로 [뉴욕-콘크리트 정글] (518회)
                    // 녹두꽃 [3~4회, 조정석X윤시윤]      # \[(\d+)(?:~(\d+))?회(?:,.*)?\])?
                    // <재> 아는 형님 [[직딩방학특집]김완선-바다-소유-케이] (177회)
                    // <재> 연애의 참견 시즌2 (29회)

                    //                    1              2              3:title        4                5
                    var m = title.match(/^(<재>)?(?:\s*\[(.*?)\])?(?:\s*(.*?))?(?:\s*\[(.*?)\])?(?:\s*\((\d+회)\))?$/);
                    if (m) {
                        program.title = m[3];
                        program.subtitle = m[2] || m[4];
                        program.rebroadcast = !!m[1];
                        program.episode = m[5];
                    }
                    else
                        throw new Error(`title parse failed: ch=${channelName}, title="${title}"`);

                    programs.push(program);
                });

                date.add(1, 'days');
            }
            while (nextLink.length > 0);

            channels[channelName] = {
                icon: '',
                group: channelGroup,
                programs: programs
            };
        }
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
    name: 'tvg',
    grab: grab
}

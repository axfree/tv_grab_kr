#!/usr/bin/env node

'use strict';

var request   = require("co-request");
var moment    = require('moment-timezone');

// channelGroups:
// 5100 지상파
// 7800 종합편성채널
// 6600 애니
// 5600 키즈
// 5800 영화
// 6300 시리즈
// 6700 드라마/예능
// 7200 라이프
// 6400 취미/레저
// 5900 스포츠
// 5300 교육
// 5700 홈쇼핑
// 7400 공공
// 7600 연예/오락
// 6900 종교
// 7300 교양/정보
// 7700 뉴스/경제
// 6501 보도

var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';

function *grab(config, argv) {
    var res = yield request.post('http://m.skbroadband.com/content/realtime/Realtime_List_Ajax.do', {
        headers: {
            'User-Agent': ua,
        },
        form: {
            // key_depth1: '',
            // key_depth2: '',
            pack: 'B캐치온',
        },
        json: true
    });

    var btvChannels = [];
    var genre;
    res.body.forEach(ch => {
        if (ch.depth == 1) {
            genre = ch;
            if (argv.listChannelGroup)
                console.log(`btv:${genre.m_name}`);
        }
        else {
            btvChannels.push({
                no: ch.ch_no,
                name: ch.m_name,
                group: genre.m_name,
                key: ch.c_menu,
            });
            if (argv.listChannels)
                console.log(`btv:${genre.m_name}:${ch.m_name}`);
        }
    });

    if (argv.listChannelGroup || argv.listChannels)
        return null;

    var channels = {};
    var startDate = moment.tz('Asia/Seoul').startOf('day');
    var endDate = moment(startDate).add(Math.min(7, config.days), 'days');

    for (var channel of btvChannels) {
        var channelFullName = `btv:${channel.group}:${channel.name}`;

        if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
            continue;

        console.log(channelFullName);

        var res = yield request.post('http://m.btvplus.co.kr/Common/Inc/IFGetData.asp', {
            headers: {
                'User-Agent': ua,
            },
            form: {
                variable: 'IF_LIVECHART_DETAIL',
                pcode: `|^|start_time=${startDate.format('YYYYMMDD')}00|^|end_time=${endDate.format('YYYYMMDD')}00|^|svc_id=${channel.key}`,
            },
            json: true
        });

        var programs = [];
        res.body.channel.programs.forEach(schedule => {
            var program = {};

            program.start = moment(schedule.startTime);
            program.end = moment(schedule.endTime);
            program.category = schedule.mainGenreName;

            // 미녀 공심이(16회)(재)
            // 원티드<5회,6회>(재)
            // TV 동물농장(재)
            // 프리한 19(6회)<여행지19>(재)     # tvN
            // 남자들의 동영상 랭크쇼 (53회)<10만 폐인 헌정 방송, 악마의 게임 16>(재)
            //                                  1               2:episode              3:subtitle
            var m = schedule.programName.match(/(.*?)(?:\s*[\(<]([\d,회]+)[\)>])?(?:\s*<([^<]*?)>)?(\(재\))?$/);
            if (m) {
                program.title = m[1];
                if (m[2])
                    program.episode = m[2];
                if (m[3])
                    program.subtitle = m[3];
                if (m[4])
                    program.rebroadcast = true;
            }
            // program.title = schedule.programName;
            // program.title.replace(/(.*?)(\(재\))$/, (match, p1) => {
            //     program.title = p1;
            //     program.rebroadcast = true;
            // });
            // program.title.replace(/(.*?)(?:\s*<([^<]*)>)$/, (match, p1, p2) => {
            //     program.title = p1;
            //     program.subtitle = p2;
            // });
            // program.title.replace(/(.*?)(?:\s*[\(<]([\d,회]+)[\)>])$/, (match, p1, p2) => {
            //     program.title = p1;
            //     program.episode = p2;
            // });

            programs.push(program);
        });

        channels[channel.name] = {
            icon: `http://m.btvplus.co.kr/img/ChannelLogo/epg_${channel.key}.png`,  // 274x84
            group: channel.group,
            programs: programs
        };
    }

    return channels;
}

module.exports = {
    name: 'btv',
    grab: grab
}

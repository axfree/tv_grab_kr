#!/usr/bin/env node

'use strict';

var request   = require("co-request");
var $         = require('cheerio');
var moment    = require('moment-timezone');
var iconv     = require('iconv-lite');
var delay     = require('delay');
var entities  = require("entities");

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
            ch.m_name = entities.decodeHTML(ch.m_name);
            btvChannels.push({
                no: ch.ch_no,
                name: ch.m_name,
                group: genre.m_name,
                d1: genre.c_menu,
                d2: ch.c_menu,
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

        var programs = [];
        var date = moment.tz('Asia/Seoul').startOf('day');
        for (var d = 0; d < 2; d++) {
            var res = yield request.get('http://m.skbroadband.com/content/realtime/Channel_List.do', {
                headers: {
                    'User-Agent': ua,
                },
                qs: {
                    key_depth1: channel.d1,                 // 5100
                    key_depth2: channel.d2,                 // 14
                    key_depth3: date.format('YYYYMMDD'),    // 20181113
                },
                encoding: null
            });

            var lis = $('#uiScheduleTabContent > div > ol > li', iconv.decode(res.body, 'cp949'));
            lis.each((idx, li) => {
                var program = {};

                var [ hh, mm ] = $('p.time', li).text().split(':');    // 06:30
                program.start = moment(date).hours(+hh).minutes(+mm);

                var m = $('p.cont', li).contents().first().text().trim().match(/(.*?)(?:\s*[\(<]([\d,회]+)[\)>])?(?:\s*<([^<]*?)>)?(\(재\))?$/);
                if (m) {
                    program.title = m[1];
                    if (m[2])
                        program.episode = m[2];
                    if (m[3])
                        program.subtitle = m[3];
                    if (m[4])
                        program.rebroadcast = true;
                }

                $('.flag_box > span', li).each((idx, span) => {
                    if ($(span).hasClass('flag06'))
                        program.rating = 12;
                    else if ($(span).hasClass('flag07'))
                        program.rating = 15;
                    else if ($(span).hasClass('flag08'))
                        program.rating = 19;
                })

                programs.push(program);
            });

            yield delay(200);
        }

        channels[channel.name] = {
            icon: `http://m.btvplus.co.kr/data/btvplus/admobd/channelLogo/nsepg_${channel.d2}.png`,
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

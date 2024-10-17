#!/usr/bin/env node

'use strict';

var request   = require("co-request");
var $         = require('cheerio');
var moment    = require('moment-timezone');
var iconv     = require('iconv-lite');
var delay     = require('delay');
var entities  = require("entities");

// channelGroups:
//   지상파/종편
//   홈쇼핑
//   영화
//   드라마/시리즈
//   스포츠/레저
//   연예/오락
//   애니/키즈
//   뉴스/경제
//   라이프/정보
//   교육/공공/종교
//   성인(유료)

var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';

function *grab(config, argv) {
    // https://www.bworld.co.kr/myb/product/btv-chnl/chnl-frmt-list.do
    var res = yield request.get('https://www.bworld.co.kr/content/realtime/realtime_list.ajax', {
        headers: {
            'User-Agent': ua,
        },
        qs: {
            pack: 'PM50305785', // B tv All+ 캐치온
            // key_depth1: '',
            // key_depth2: '',
            // key_depth3: '',
            // key_depth2_name: '',
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
                id_svc: ch.id_svc,
            });
            if (argv.listChannels)
                console.log(`btv:${genre.m_name}:${ch.m_name}`);
        }
    });

    if (argv.listChannelGroup || argv.listChannels)
        return null;

    var channels = {};

    for (var channel of btvChannels) {
        var channelFullName = `btv:${channel.group}:${channel.name}`;

        if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
            continue;

        if (argv.debug)
            console.log(channelFullName);

        var programs = [];
        var date = moment.tz('Asia/Seoul').startOf('day');

        var res = yield request.get(`https://www.bworld.co.kr/myb/core-prod/product/btv-channel/week-frmt-list`, {
            headers: {
                'User-Agent': ua,
                'Referer': 'https://www.bworld.co.kr/myb/product/btv-chnl/chnl-frmt-list.do',
                // 'Referer': 'https://www.bworld.co.kr/myb/product/btv-chnl/chnl-frmt-list.do?cdMenu=0&idSvc=12&gubun=week',
            },
            qs: {
                gubun: 'week',
                stdDt: date.format('YYYYMMDD'),
                idSvc: channel.id_svc   // 12
            },
            json: true
        });

        res.body.result.chnlFrmtInfoList.sort((a, b) => a.dtEventStart - b.dtEventStart).forEach(r => {
            // {
            //     "idSvc": "12",
            //     "nmTitle": "수목드라마 개소리(7회)(재)",
            //     "cdRating": "15",
            //     "dtEventStart": "20241017111000",
            //     "dtEventEnd": "20241017121500",
            //     "eventDt": "20241017",
            //     "eventMmdd": "1017",
            //     "eventTime": "11:10",
            //     "eventHour": "11",
            //     "eventMinute": "10",
            //     "onAirYn": "Y",
            //     "cdGenre": "1",
            //     "cdCategory": "",
            //     "nmSynop": "",
            //     "idEvent": "8512",
            //     "idMaster": null,
            //     "dispYn": "Y",
            //     "delYn": "N"
            // }
            var program = {};

            program.start = moment(r.dtEventStart + '+0900', 'YYYYMMDDHHmmssZ');
            program.end = moment(r.dtEventEnd + '+0900', 'YYYYMMDDHHmmssZ');

            var m = r.nmTitle.match(/(.*?)(?:\s*[\(<]([\d,회]+)[\)>])?(?:\s*<([^<]*?)>)?(\(재\))?$/);
            if (!m)
                throw new Error('no title');

            program.title = m[1];
            if (m[2])
                program.episode = m[2];
            if (m[3])
                program.subtitle = m[3];
            if (m[4])
                program.rebroadcast = true;

            if (r.cdRating != '0')
                program.rating = +r.cdRating;   // 7, 12, 15, 19

            programs.push(program);
        });

        yield delay(200);

        channels[channel.name] = {
            // icon: `http://m.btvplus.co.kr/data/btvplus/admobd/channelLogo/nsepg_${channel.d2}.png`,
            number: channel.no,
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

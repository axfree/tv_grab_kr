#!/usr/bin/env node

'use strict';

var request   = require("co-request");
var $         = require('cheerio');
var moment    = require('moment-timezone');
var entities  = require("entities");

var broadcastTypes = { 100: '지상파', 500: '종합편성', 200: '케이블', 300: '스카이라이프', 9000: '해외위성', 400: '라디오' };

function *grab(config, argv) {
    var channels = {};

    for (var u1 in broadcastTypes) {
        var broadcastType = broadcastTypes[u1];
        var res = yield request.get('https://m.search.naver.com/p/csearch/content/nqapirender.nhn', {
            qs: {
                callback: '',           // jQuery112403933569637440637_1631181885852
                pkid: 66,
                where: 'nexearch',
                u1: u1,                 // 100
                key: 'ScheduleChannelList',
                _: Date.now(),          // 1631181885855
            },
            json: true
        });

        var genres = $('.genre_list > .item', res.body.dataHtml);
        for (var genre of genres.get()) {
            var channelGroup = $(genre).parent().prev('strong').text();
            if (argv.listChannelGroup) {
                console.log(channelGroup ? `naver:${broadcastType}:${channelGroup}` : `naver:${broadcastType}`);
                continue;
            }

            var channelsAs = $('.channel_name > a', genre);
            for (var a of channelsAs.get()) {
                var channelName = $(a).text().trim().replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1')
                                                    .replace(/^MBC(경남)/, 'MBC $1')
                                                    .replace(/^(진주)MBC/, 'MBC $1');
                var channelFullName = channelGroup ? `naver:${broadcastType}:${channelGroup}:${channelName}` : `naver:${broadcastType}:${channelName}`;
                if (argv.listChannels) {
                    console.log(channelFullName);
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

                var res = yield request.get('https://search.naver.com/search.naver' + $(a).attr('href'));

                var programs = [];
                var date = moment.tz('Asia/Seoul').startOf('day');
                for (var c = 2; c < 5/*8*/; c++) {
                    for (var r = 0; r < 24; r++) {
                        var pts = $(`.program_list > li:nth-child(${r+1}) > div:nth-child(${c+1}) > .inner`, res.body);
                        pts.each((idx, pt) => {
                            //                                     1:mm     2:title   3:subtitle  4:ep           5:rt
                            var m = $(pt).text().trim().match(/^(?:(\d+)분) (.*?)(?: <(.*)>)?(?:\((\d+회)\))?(?:  (\d+)세)?$/);
                            if (m) {
                                programs.push({
                                    start: moment(date).hours(r).minutes(m[1]),
                                    title: m[2],
                                    subtitle: m[3],
                                    episode: m[4],
                                    rebroadcast: $('.s_label.re', pt).length > 0,
                                    rating: m[5]
                                });
                            }
                        })
                    }
                    date.add(1, 'days');
                }

                channels[channelName] = {
                    icon: '',
                    group: channelGroup || broadcastType,
                    programs: programs
                };
            }
        }
    }

    return channels;
}

module.exports = {
    name: 'naver',
    grab: grab
}

#!/usr/bin/env node

'use strict';

var request   = require("co-request");
var $         = require('cheerio');
var moment    = require('moment-timezone');
var entities  = require("entities");

var broadcastTypes = [ '지상파', '종합편성', '케이블', '스카이라이프', '해외위성', '라디오' ];
var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';

function *grab(config, argv) {
    var channels = {};
    for (var broadcastType of broadcastTypes) {
        var res = yield request.get('http://search.naver.com/search.naver', {
            headers: {
                'user-agent': ua,
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'accept-language': 'en-US,en;q=0.8,ko;q=0.6',
            },
            qs: { where:'nexearch', ie:'utf8', sm:'tab_etc', query: broadcastType + ' 편성표' },
        });

        var channelLIs = $('.lst_channel > li', res.body);
        for (var li of channelLIs.get()) {
            var channelGroup = $('h6 > a', li).text();
            if (argv.c) {
                console.log(`naver:${broadcastType}:${channelGroup}`);
                continue;
            }

            var channelsAs = $('ul.lst_channel_s > li > a', li);
            // channelsAs = $('<a href="?where=nexearch&ie=utf8&sm=tab_etc&query=%EC%82%B0%EC%97%85%EB%B0%A9%EC%86%A1%20%EC%B1%84%EB%84%90i%20%ED%8E%B8%EC%84%B1%ED%91%9C">산업방송 채널i</a>');
            for (var a of channelsAs.get()) {
                var channelName = $(a).text().trim().replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1')
                                                    .replace(/^MBC(경남)/, 'MBC $1')
                                                    .replace(/^(진주)MBC/, 'MBC $1');
                var channelFullName = `naver:${broadcastType}:${channelGroup}:${channelName}`;
                if (argv.l) {
                    console.log(channelFullName);
                    continue;
                }

                if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
                    continue;

                if (channels[channelName]) {
                    // console.log(channelName, 'skip');
                    continue;
                }
                console.log(channelFullName);

                var res = yield request.get('http://search.naver.com/search.naver' + $(a).attr('href'), {
                    headers: {
                        'user-agent': ua,
                        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'accept-language': 'en-US,en;q=0.8,ko;q=0.6',
                    },
                });

                var m = res.body.match(/var htInitDataForTvtimeSchedule = ({[^]*?}) <\/script>/);
                if (m) {
                    var data = JSON.parse(m[1].replace(/\/\*.*?\*\//g, ''));
                    var res = yield request.get('https://search.naver.com/p/csearch/content/batchrender_ssl.nhn', {
                        headers: {
                            'user-agent': ua,
                        },
                        qs: {
                            where: 'nexearch',
                            pkid: 66,
                            // _callback: 'window.__jindo2_callback._7071',
                            u1: data.ptnId,
                            u2: data.totalDates.join(','),
                            // u3: data.searchDate,
                            u4: 8,
                            u5: data.os,
                            u6: 1,
                            // u7: data.apiQuery,
                            // u8: data.channelQuery,
                            fileKey: data.ptnId
                        },
                    });
                    var data = JSON.parse(res.body.replace(/\/\*.*?\*\//g, ''));
                    var programs = [];
                    data.displayDates.forEach((displayDate, idx) => {
                        for (var h = 0; h < 24; h++) {
                            data.schedules[h][idx].forEach(schedule => {
                                programs.push({
                                    start: moment(displayDate.date + schedule.startTime + '+0900', 'YYYYMMDDHHmmZ'),
                                    title: entities.decodeHTML(schedule.title),
                                    episode: schedule.episode,
                                    rebroadcast: schedule.isRerun,
                                    rating: schedule.grade
                                });
                            });
                        }
                    });

                    channels[channelName] = {
                        icon: '',
                        group: channelGroup,
                        programs: programs
                    };
                }
            }
        }
    }

    return channels;
}

module.exports = {
    name: 'naver',
    grab: grab
}

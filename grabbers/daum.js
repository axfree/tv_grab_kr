#!/usr/bin/env node

'use strict';

var request   = require("co-request");
var $         = require('cheerio');
var moment    = require('moment-timezone');

var broadcastTypes = [ '지상파', '종합편성', '케이블', '스카이라이프', '해외위성', '라디오' ];
var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';

function *grab(config, argv) {
    var channels = {};
    for (var broadcastType of broadcastTypes) {
        var res = yield request.get('http://search.daum.net/search', {
            headers: {
                'User-Agent': ua,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.8,ko;q=0.6',
            },
            qs: { w:'tot', q: broadcastType + ' 편성표' },
        });

        var channelULs = $('.layer_tv ul', res.body);
        if (channelULs.length == 0) // 종합편성
            channelULs = $('#channelNaviLayer', res.body);

        // channelsAs = $('<a>ocn</a>');
        for (var ul of channelULs.get()) {
            var channelGroup = $(ul).parent().find('strong').text().trim();
            var channelAs = $('a', ul);
            if (argv.listChannelGroup) {
                console.log(channelGroup ? `daum:${broadcastType}:${channelGroup}` : `daum:${broadcastType}`);
                continue;
            }

            for (var a of channelAs.get()) {
                var channelName = $(a).text().trim().replace(/^HD /, '')
                                                    .replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1')
                                                    .replace(/^MBC(경남|강원영동)/, 'MBC $1')
                                                    .replace(/^(진주)MBC/, 'MBC $1');
                var channelFullName = channelGroup ? `daum:${broadcastType}:${channelGroup}:${channelName}` : `daum:${broadcastType}:${channelName}`;
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

                var res = yield request.get('http://search.daum.net/search' + $(a).attr('href'), {
                    headers: {
                        'User-Agent': ua,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.8,ko;q=0.6',
                    },
                });

                var startDateKST = moment.tz('Asia/Seoul').startOf('day').add(-1, 'days');
                // console.log(startDateKST.format('YYYYMMDDHHmmss Z'));

                var programs = [];
                var scheduleTable = $('.wrap_tbl', res.body);
                for (var d = 0; d < 8; d++) {
                    // console.log(startDateKST.format());
                    for (var h = 0; h < 24; h++) {
                        var dls = $(`td#channelBody${h}_${d} dl`, scheduleTable);
                        dls.each((idx, dl) => {
                            var m = $('dt', dl).text();
                            var program = {};
                            // program.rating = 0;
                            program.start = moment(startDateKST).hours(h).minutes(m);
                            // console.log(program.start.format('YYYYMMDDHHmmss Z'));
                            var titles = $('dd', dl).children();
                            titles.each((idx, c) => {
                                var text = $(c).text().trim();
                                if (idx == 0) {
                                    var titleMatches = text.match(/^(.*?)(?: <(.*)>)?(?: (\d+회))?$/);
                                    if (titleMatches) {
                                        program.title = titleMatches[1];
                                        if (titleMatches[2])
                                            program.subtitle = titleMatches[2];
                                        if (titleMatches[3])
                                            program.episode = titleMatches[3];
                                    }
                                    else {
                                        program.title = text;
                                        console.error('title format error: title=' + text);
                                    }
                                }
                                else {
                                    if (text == '재방송')
                                        program.rebroadcast = true;
                                    else {
                                        var gradeMatch = text.match(/프로그램등급 (\d+)세/);
                                        if (gradeMatch)
                                            program.rating = parseInt(gradeMatch[1]);
                                    }
                                }
                            });

                            programs.push(program);
                        })
                    }

                    startDateKST.add(1, 'days');
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
    name: 'daum',
    grab: grab
}

#!/usr/bin/env node

'use strict';

var request   = require("co-request");
var $         = require('cheerio');
var moment    = require('moment-timezone');
var iconv     = require('iconv-lite');

// channelGroups:
//   지상파
//   종합편성채널
//   애니
//   키즈
//   영화
//   시리즈
//   드라마/예능
//   라이프
//   취미/레저
//   스포츠
//   교육
//   홈쇼핑
//   공공
//   연예/오락
//   종교
//   교양/정보
//   뉴스/경제
//   보도

var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';

function *grab(config, argv) {
    var res = yield request.get('http://www.skbroadband.com/content/realtime/Realtime_List.do', {
        headers: {
            'User-Agent': ua,
        },
        encoding: null,
    });

    // console.log(iconv.decode(res.body, 'cp949'));
    var channels = [];
    var channelGroupsDIVs = $('.channal-list-inner', iconv.decode(res.body, 'cp949'));
    for (var div of channelGroupsDIVs.get()) {
        var channelGroup = $('h2 > a', div).text().trim();
        if (argv.c) {
            console.log(`btv:${channelGroup}`);
            continue;
        }

        var lis = $('ul > li', div);
        for (var li of lis.get()) {
            var channelNumber = $('em', li).text().match(/[(\d+)]/) [1];
            var a = $('a', li);
            var m = $(a).attr('onclick').match(/'(\d+)','(\d+)','(.*)','(.*)'/);
            var channelName = $(a).text().trim();
            var channelFullName = `btv:${channelGroup}:${channelName}`;

            if (argv.l) {
                console.log(`btv:${channelGroup}:${channelName}`);
                continue;
            }

            if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
                continue;

            if (channels[channelName]) {
                // console.log(channelName, 'skip');
                continue;
            }
            console.log(channelFullName);

            var res = yield request.post('http://www.skbroadband.com/content/realtime/Channel_List.do', {
                headers: {
                    'User-Agent': ua,
                },
                encoding: null,
                form: {
                    // retUrl:
                    pageIndex: 1,
                    // pack:(unable to decode value)
                    // tab_gubun:1
                    key_depth1: m[1],       // 5100,
                    key_depth2: m[2],       // 14,
                    key_depth3: m[3],
                    // key_chno:
                    key_depth2_name: m[4],  // SBS,
                    menu_id: 'C02010000',
                }
            });

            var programs = [];
            var date = moment.tz('Asia/Seoul').startOf('day');
            var trs = $('.uio-table-time tr', iconv.decode(res.body, 'cp949'));
            trs.each((h, tr) => {
                var tds = $('td', tr);
                tds.each((d, td) => {
                    var item = $(td).children().first();
                    while (item.length > 0) {
                        if (!item.text().match(/^\d{2}분$/))
                            break;

                        var program = {};
                        program.start = moment(`${date.format('YYYYMMDD')}.${h}.${item.text()}+0900`, 'YYYYMMDD.H.mm분Z').add(d, 'days');
                        item = item.next();
                        $('span', item).each((idx, span) => {
                            if ($(span).hasClass('subject')) {
                                var title = $(span).text().trim();
                                // 미녀 공심이(16회)(재)
                                // 원티드<5회,6회>(재)
                                // TV 동물농장(재)
                                // 프리한 19(6회)<여행지19>(재)     # tvN
                                //                   1               2:episode               3:subtitle
                                var m = title.match(/(.*?)(?:\s*[\(<]([\d,회]+)[\)>])?(?:\s*<(.*?)>)?(\(재\))?$/);
                                if (m) {
                                    program.title = m[1];
                                    if (m[2])
                                        program.episode = m[2];
                                    if (m[3])
                                        program.subtitle = m[3];
                                    if (m[4])
                                        program.rebroadcast = true;
                                }
                            }
                            else {
                                var m = $(span).text().match(/^(\d+)$/);
                                if (m)
                                    program.rating = parseInt(m[1]);
                            }
                        });

                        programs.push(program);
                        item = item.next();
                    }
                });
            })

            programs.sort((a, b) => {
                return a.start.diff(b.start);
            });

            channels[channelName] = {
                icon: '',
                group: channelGroup,
                programs: programs
            };
        }
    }

    return channels;
}

module.exports = {
    name: 'btv',
    grab: grab
}

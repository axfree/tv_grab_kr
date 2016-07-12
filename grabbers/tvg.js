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

    var channels = [];
    var channelGroupsAs = $('#CATEGORY > ul > li > a', iconv.decode(res.body, 'cp949'));
    for (var a of channelGroupsAs.get()) {
        var channelGroup = $(a).text();
        if (argv.c) {
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

        var channelAs = $('li > a', iconv.decode(res.body, 'cp949'));
        for (var a of channelAs.get()) {
            var m = $(a).text().match(/(.*)\(Ch\.(\d+)\)/);
            var channelName = m[1].replace(/-Full HD$/, '')
                                  .replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1')
                                  .replace(/^MBC(경남)/, 'MBC $1')
                                  .replace(/^(진주)MBC/, 'MBC $1');
            var channelNumber = m[2];
            var channelFullName = `tvG:${channelGroup}:${channelName}`;
            var channelCode = $(a).attr('onclick').match(/'(\d+)','(\d+)'/) [1];

            if (argv.l) {
                console.log(`tvG:${channelGroup}:${channelName}`);
                continue;
            }

            if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
                continue;

            if (channels[channelName]) {
                // console.log(channelName, 'skip');
                continue;
            }
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
                var body = iconv.decode(res.body, 'cp949');
                var nextLink = $('a.next', body);

                var trs = $('tbody > tr', body);
                trs.each((idx, tr) => {
                    var startTime = $('td:nth-child(1)', tr).text();    // 23:10
                    var title = $('td:nth-child(2)', tr).text().trim();
                    var program = {
                        start: moment(date.format('YYYYMMDD') + startTime + '+0900', 'YYYYMMDDHH:mmZ'),
                        category: $('td:nth-child(3)', tr).text().trim(),
                        rating: 0
                    }

                    $('img', tr).each((idx, img) => {
                        var alt = $(img).attr('alt');
                        var m = alt.match(/(\d+)세이상 관람가/);
                        if (m)
                            program.rating = parseInt(m[1]);
                    })

                    // (생) [포르투갈:웨일스] UEFA 유로 2016 준결승
                    // 국내특선다큐 [디지털 콘텐츠, 공짜와의 전쟁 2부]
                    // 청년창업 RUNWAY [친환경 유아용품 전문 브랜드 최..
                    // Smartest Guy In The Room (S1) (9,10회)
                    // 방송 정보 없음

                    // fix unbalanced parenthesis/brackets
                    if (title.endsWith('..')) {
                        var fixedTitle = '';
                        var opens = [];
                        var openers = '([{<';
                        var closers = ')]}>';
                        for (var c of title) {
                            var idx = openers.indexOf(c);
                            if (idx >= 0)
                                opens.push(idx);
                            else {
                                idx = closers.indexOf(c);
                                if (idx >= 0) {
                                    if (opens.length == 0 || opens[opens.length - 1] != idx)
                                        c = openers[idx] + c;
                                    else
                                        opens.pop();
                                }
                            }
                            fixedTitle += c;
                        }
                        opens.reverse().forEach(idx => fixedTitle += closers[idx]);

                        if (title != fixedTitle) {
                            // console.log(`title changed: old=${title}, new=${fixedTitle}`);
                            title = fixedTitle;
                        }
                    }

                    //                    1                2              3:title        4                5
                    var m = title.match(/^(\(생\))?(?:\s*\[(.*?)\])?(?:\s*(.*?))?(?:\s*\[(.*?)\])?(?:\s*\(([\d,]+회)\))?$/);
                    if (m) {
                        if (m[3]) {
                            program.title = m[3];
                            program.subtitle = m[2] || m[4];
                        }
                        else
                            program.title = m[2] || m[4];
                        program.live = !!m[4];
                        program.episode = m[5];
                    }

                    // if (!program.title) {
                    //     console.error(channelFullName, title, program.title);
                    //     process.exit(0);
                    // }

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

module.exports = {
    name: 'tvg',
    grab: grab
}

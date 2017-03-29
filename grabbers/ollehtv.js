#!/usr/bin/env node

'use strict';

var request   = require("co-request");
var $         = require('cheerio');
var moment    = require('moment-timezone');
var iconv     = require('iconv-lite');

// channelGroups:
//   otl:
//     지상파/종편/홈쇼핑
//     드라마/오락/음악
//     영화/시리즈
//     스포츠/레져
//     애니/유아/교육
//     다큐/교양/종교
//     뉴스/경제
//     공공/공익/정보
//     오픈
//     유료
//     오디오
//   ots:
//     지상파/종편/홈쇼핑
//     드라마/오락/음악
//     영화/시리즈
//     스포츠/레져
//     애니/유아/교육
//     다큐/교양/종교
//     뉴스/경제
//     공공/공익/정보
//     오픈
//     유료
//     오디오

var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';

var channelTypes = { 1:'otl', 2:'ots' };

function *grab(config, argv) {
    var channels = {};
    for (var channelType of Object.keys(channelTypes)) {
        var channelGrabber = channelTypes[channelType];
        var res = yield request.post('http://tv.olleh.com/tvinfo/liveCH/live.asp', {
            headers: {
                'User-Agent': ua,
            },
            form: {
                ch_type: channelType
            },
            encoding: null
        });

        var channelLists = $('.channelList', iconv.decode(res.body, 'cp949'));
        for (var channelList of channelLists.get()) {
            var channelGroup = $('h4', $(channelList)).text();
            if (argv.listChannelGroup) {
                console.log(`${channelGrabber}:${channelGroup}`);
                continue;
            }
            for (var a of $('a', $(channelList)).get()) {
                var href = $(a).attr('href');
                var m = href.match(/javascript:day\('(\d+)','(.*)','(\d+)'\);/);
                if (!m) {
                    // javascript:alert('해당 채널의 편성표는 TV에서만 제공 됩니다.');
                    continue;
                }
                var channelNumber = m[1];
                var channelName = m[2];
                var channelFullName = `${channelGrabber}:${channelGroup}:${channelName}`;

                if (argv.listChannels) {
                    console.log(channelFullName);
                    continue;
                }

                if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
                    continue;

                console.log(channelFullName);

                var programs = [];
                var date = moment.tz('Asia/Seoul');
                for (var d = 0; d < 3; d++) {
                    var res = yield request('http://tv.olleh.com/renewal_sub/liveTv/pop_schedule_week.asp', {
                        headers: {
                            'User-Agent': ua,
                        },
                        qs: {
                            chtype: channelType,
                            ch_no: channelNumber,
                            // ch_name: channelName,
                            nowdate: date.format('YYYYMMDD')    // 20170329
                        },
                        encoding: null
                    });
                    var trs = $('#pop_day > tbody > tr', iconv.decode(res.body, 'cp949'));
                    trs.each((idx, tr) => {
                        var tds = $('td', $(tr));
                        var [ h, m ] = tds.eq(0).text().split(':');
                        var program = {
                            start: moment(date).hours(+h).minutes(+m),
                            title: tds.eq(1).text(),
                            category: tds.eq(4).text()
                        };
                        var ratingMatches = tds.eq(2).text().match(/(\d+)세 이상/);
                        if (ratingMatches)
                            program.rating = +ratingMatches[1];

                        programs.push(program);
                    });

                    date.add(1, 'days');
                }

                channels[channelName] = {
                    icon: (channelGrabber == 'otl') ? `http://tv.olleh.com/img/channel/${channelNumber}.png`  // 80x30
                                                    : `http://tv.olleh.com/qts/channel/img/channel/ch_${channelNumber}.png`,
                    group: channelGroup,
                    programs: programs
                };
            }
        }
    }

    return channels;
}

module.exports = {
    name: 'ollehtv',
    grab: grab
}

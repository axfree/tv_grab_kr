#!/usr/bin/env node

'use strict';

var request   = require("co-request");
var $         = require('cheerio');
var moment    = require('moment-timezone');
var iconv     = require('iconv-lite');

// channelGroups:
//   레저

var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';

function *grab(config, argv) {
    var channels = {};
    var channelGroup = '레저';
    var channelName = '폴라리스TV';
    var channelFullName = `polaristv:${channelGroup}:${channelName}`;

    if (argv.listChannelGroup) {
        console.log(`polaristv:${channelGroup}`);
        return null;
    }

    if (argv.l) {
        console.log(channelFullName);
        return null;
    }

    if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
        return [];

    console.log(channelFullName);

    var res = yield request.get('http://www.polaristv.com/schedule.asp', {
        headers: {
            'User-Agent': ua,
        }
    });

    var dateMatches = res.body.match(/주간편성표 \((.*?) ~ (.*?)\)/);
    if (!dateMatches)
        return [];

    var date = moment(dateMatches[1] + '+0900', 'YYYYMMDDZ');
    var programs = [];
    for (var d = 1; d <= 7; d++) {
        var tds = $(`td.${d}a > div.pro_title`, res.body);
        if (tds.length == 0)
            tds = $(`td.${d}a`, res.body);

        tds.each((idx, td) => {
            var h = 6 + idx;
            var program = {};
            $(td).children().each((idx, pro) => {
                var m = +$('.pro_title_min', pro).text();
                var title = $('.pro_title_txt', pro).text();
                program.start = moment(date).hours(h).minutes(m);
                // https://regex101.com/r/UziqxB/1
                //
                // 여행의발견(캄보디아1)
                // 드라마스페셜(이브의 복수3회)
                // 렛미트레블(3회)
                // 대한민국 구석구석 (6회)
                var titleMatches = title.match(/(.+?)\s*(?:\((.*?)(\d+회)?\))/);
                if (titleMatches) {
                    program.title = titleMatches[1];
                    program.subtitle = titleMatches[2];
                    program.episode = titleMatches[3];
                }
                else {
                    program.title = title;
                }

                programs.push(program);
            });
        });

        date.add(1, 'days');
    }

    channels[channelName] = {
        icon: 'http://www.polaristv.com/images/logo2.png',
        group: channelGroup,
        programs: programs
    };

    return channels;
}

module.exports = {
    name: 'polaristv',
    grab: grab
}

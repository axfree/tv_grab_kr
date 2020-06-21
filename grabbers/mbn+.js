#!/usr/bin/env node

'use strict';

var request   = require("co-request");
var $         = require('cheerio');
var moment    = require('moment-timezone');
var iconv     = require('iconv-lite');

// channelGroups:
//   오픈

var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';

function *grab(config, argv) {
    var channels = {};
    var channelGroup = '오픈';
    var channelName = 'MBN+';
    var channelFullName = `mbn+:${channelGroup}:${channelName}`;

    if (argv.listChannelGroup) {
        console.log(`mbn+:${channelGroup}`);
        return null;
    }

    if (argv.listChannels) {
        console.log(channelFullName);
        return null;
    }

    if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
        return [];

    if (argv.debug)
        console.log(channelFullName);

    var programs = [];
    var date = moment.tz('Asia/Seoul').startOf('day').add(-1, 'days');  // start from yesterday
    for (var d = 0; d < 7; d++) {
        var res = yield request.post('http://plus.mbn.co.kr/pages/schedule/scheduleCable.mbn', {
            headers: {
                'User-Agent': ua,
            },
            form: {
                choiceDate: date.format('YYYYMMDD')
            }
        });

        var trs = $('.tvguide > tbody > tr', res.body);
        trs.each((idx, tr) => {
            var program = {};

            var td = $(tr).children().first();
            var h = parseInt(td.text().split(':')[0]);
            var m = parseInt(td.text().split(':')[1]);
            program.start = moment(date).hours(h).minutes(m);

            td = td.next();
            if (td.attr('colspan') == '2') {
                var title = $('dl > dt > span > a', td).text().trim();
                var titleMatches = title.match(/^\[(.*?)\] (.*?)(?: (\d+회))?$/);
                if (titleMatches) {
                    program.category = titleMatches[1];
                    program.title = titleMatches[2];
                    if (titleMatches[3])
                        program.episode = titleMatches[3];
                }

                program.desc = $('dl > dd', td).text().trim();
            }
            else {
                program.category = td.text().trim();

                td = td.next();
                var title = td.text().trim();
                var titleMatches = title.match(/^(.*?)(?: (\d+회))?$/);
                if (titleMatches) {
                    program.title = titleMatches[1];
                    if (titleMatches[2])
                        program.episode = titleMatches[2];
                }
            }

            td = td.next();
            $('div', td).each((i, div) => {
                if ($(div).hasClass('rerun'))
                    program.rebroadcast = true;
                else if ($(div).hasClass('age')) {
                    var alt = $('img', div).attr('alt');
                    var ratingMatches = alt.match(/(\d+)세이상 시청가/);
                    if (ratingMatches)
                        program.rating = +ratingMatches[1];
                    // else
                    //     program.rating = 0;
                }
            });

            programs.push(program);
        });

        date.add(1, 'days');
    }

    channels[channelName] = {
        icon: 'http://img.mbn.co.kr/newmbn/mbnplus/l_mbn_plus.gif',
        group: channelGroup,
        programs: programs
    };

    return channels;
}

module.exports = {
    name: 'mbn+',
    grab: grab
}

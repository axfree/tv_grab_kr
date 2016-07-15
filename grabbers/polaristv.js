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

    if (argv.c) {
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

    var res = yield request.get('http://www.polaristv.co.kr/bbs/board.php?bo_table=qtone&wr_id=21', {
        headers: {
            'User-Agent': ua,
        },
        json: true,
    });

    var date = moment.tz('Asia/Seoul').startOf('isoWeek');  // this monday
    var dateMatches = res.body.match(/\d+월 \d주차 \((\d+)\.(\d+)~/);
    if (dateMatches) {
        var m = +dateMatches[1];
        var d = +dateMatches[2];
        if (date.month() + 1 != m || date.date() != d) {
            console.error('epg is not yet updated for this week');
            date.add(-7, 'days');
            // return 0;
        }
    }

    var res = yield request.get('http://www.polaristv.co.kr/bbs/getSchedule.php?bo_table=qtone&wr_id=21', {
        headers: {
            'User-Agent': ua,
        },
        json: true,
    });

    var programs = [];
    var data = res.body;
    for (var k in data) {
        var schedules = data[k];
        for (var t in schedules) {
            var schedule = schedules[t];
            var h = parseInt(t.split(':')[0]);
            var m = parseInt(t.split(':')[1]);
            var program = {};
            program.start = moment(date).hours(h).minutes(m);
            if (h >= 0 && h < 6)
                program.start.add(1, 'days');
            var matches = schedule.name.replace(/<br \/>/g, ' ')
                                       .replace(/  /g, ' ')
                                       .match(/(.*?)(?:\s*\((.*?)\))?$/);
            if (matches) {
                // console.dir(matches);
                program.title = matches[1];
                if (matches[2]) {
                    // extract episode number from the subtitle
                    var episodeMatches = matches[2].match(/^(.*?)(\d+)회?$/);
                    if (episodeMatches) {
                        if (episodeMatches[1])
                            program.subtitle = episodeMatches[1];
                        program.episode = episodeMatches[2] + '회';
                    }
                    else
                        program.subtitle = matches[2];
                }

                if (!program.episode) {
                    // extract episode number from the title
                    var episodeMatches = program.title.match(/(.*?) (\d+)$/);
                    if (episodeMatches) {
                        program.title = episodeMatches[1];
                        program.episode = episodeMatches[2] + '회';
                    }
                }
            }

            programs.push(program);
        }

        date.add(1, 'days');
    }

    channels[channelName] = {
        icon: 'http://www.polaristv.co.kr/images/logo2.png',
        group: channelGroup,
        programs: programs
    };

    return channels;
}

module.exports = {
    name: 'polaristv',
    grab: grab
}

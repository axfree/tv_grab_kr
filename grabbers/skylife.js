#!/usr/bin/env node

'use strict';

var request   = require("co-request");
var moment    = require('moment-timezone');

var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';

function *grab(config, argv) {
    if (argv.l || argv.c) {
        var res = yield request.post('http://www.skylife.co.kr/channel/channel_number/channelListAjax.do', {
            headers: {
                'User-Agent': ua,
            },
            form: { fd_mapp_cd: '' },
            json: true
        });

        var channels = [];
        for (var channel of res.body.channelList) {
            var channelName = channel.fd_channel_name.replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1')
                                                     .replace(/^MBC(경남)/, 'MBC $1')
                                                     .replace(/^(진주)MBC/, 'MBC $1')
                                                     .replace(/^jtbc/i, 'JTBC');
            channels.push({
                name: channelName,
                group: channel.fd_genre_name || ''
            });
        }
        channels.sort((a, b) => {
            return `${a.group}:${a.name}`.localeCompare(`${b.group}:${b.name}`);
        })

        var lastGroup = '.';
        channels.forEach(c => {
            if (c.group != lastGroup) {
                if (argv.c)
                    console.log(`skylife:${c.group}`);
                lastGroup = c.group;
            }
            if (argv.l)
                console.log(`skylife:${c.group}:${c.name}`);
        });

        return null;
    }

    var res = yield request.post('http://www.skylife.co.kr/channel/channel_number/channelListAjax.do', {
        headers: {
            'User-Agent': ua,
        },
        form: { fd_mapp_cd: '' },
        json: true
    });

    var channels = {};
    var channelList = res.body.channelList;
    for (var channel of channelList) {
        // console.dir(channel);
        if (!channel.fd_channel_id)
            continue;

        var channelName = channel.fd_channel_name.replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1')
                                                 .replace(/^MBC(경남)/, 'MBC $1')
                                                 .replace(/^(진주)MBC/, 'MBC $1')
                                                 .replace(/^jtbc/i, 'JTBC');
        var channelFullName = `skylife:${channel.fd_genre_name || ''}:${channelName}`;
        if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
            continue;

        if (channels[channelName]) {
            // console.log(channelName, 'skip');
            continue;
        }
        console.log(channelFullName);

        var programs = [];
        var date = moment.tz('Asia/Seoul').startOf('day');
        for (var d = 0; d < 2; d++) {
            var res = yield request.post('http://www.skylife.co.kr/channel/epg/channelScheduleList.do', {
                headers: {
                    'User-Agent': ua,
                },
                form: {
                    area: 'in',
                    indate_type: 'now',                 // 'next', 'next'
                    inairdate: date.format('YYYY-M-D'), // '2016-7-5',
                    inFd_channel_id: channel.fd_channel_id
                },
                json: true
            });

            res.body.scheduleListIn.forEach(schedule => {
                var start = moment(schedule.starttime + '+0900', 'YYYYMMDDHHmmssZ');
                if (start.diff(date) < 0)
                    return;

                programs.push({
                    start: moment(schedule.starttime + '+0900', 'YYYYMMDDHHmmssZ'),
                    stop: moment(schedule.endtime + '+0900', 'YYYYMMDDHHmmssZ'),
                    title: schedule.program_name,
                    subtitle: schedule.program_subname,
                    category: schedule.program_category1,
                    episode: schedule.episode_id + '회',
                    rebroadcast: schedule.rebroad,
                    desc: schedule.summary,
                    rating: schedule.grade
                });
            });

            date.add(1, 'days');
        }

        channels[channelName] = {
            icon: 'http:' + channel.fd_logo_path,
            group: channel.fd_genre_name || '',
            programs: programs
        };
    }

    return channels;
}

module.exports = {
    name: 'skylife',
    grab: grab
}

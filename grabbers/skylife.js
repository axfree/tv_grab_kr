#!/usr/bin/env node

'use strict';

var request   = require("co-request");
var moment    = require('moment-timezone');
var entities  = require("entities");

var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';

// channelGroups:
//   UHD
//   skyTV
//   지상파/종편
//   경제/보도
//   영화/시리즈
//   드라마
//   스포츠
//   홈쇼핑/T커머스
//   연예/오락/음악
//   생활/레저/취미
//   교양/정보/다큐
//   어린이/만화/교육
//   공공/공익/준공익
//   종교
//   유료/PPV
//   해외
//   오디오

function *grab(config, argv) {
    var jar = request.jar();
    var res = yield request('https://www.skylife.co.kr/channel/epg/channelChart.do', {
        jar: jar,
        headers: {
            'User-Agent': ua,
        }
    });
    var genres = {};
    res.body.replace(/getChannelList\('(\d+?)','(.+?)'\)/g, (m, id, name) => genres[id] = name.trim());

    var channels = [];
    for (var genreId of Object.keys(genres)) {
        if (argv.listChannelGroup) {
            console.log(`skylife:${genres[genreId]}`);
            continue;
        }
        var res = yield request.post('https://www.skylife.co.kr/channel/epg/channelScheduleListInfo.do', {
            jar: jar,
            headers: {
                'User-Agent': ua,
                // Referer: 'https://www.skylife.co.kr/channel/epg/channelChart.do'
            },
            form: {
                area: 'out',
                date_type: 'now',
                // airdate: date.format('YYYY-MM-DD'),         // 2017-05-08
                pk_epg_mapp: '',
                fd_mapp_cd: genreId,                        // 4003
                searchColumn: '',
                searchString: '',
                selectString: ''
            },
            json: true
        });

        for (var channel of res.body.channelListInfo) {
            var channelName = channel.fd_channel_name.replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1')
                                                     .replace(/^MBC(경남)/, 'MBC $1')
                                                     .replace(/^(진주)MBC/, 'MBC $1')
                                                     .replace(/^jtbc/i, 'JTBC');
            var channelFullName = `skylife:${genres[genreId]}:${channelName}`;
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

            var programs = [];
            var date = moment.tz('Asia/Seoul').startOf('day');
            for (var d = 0; d < 2; d++) {
                var res = yield request.post('https://www.skylife.co.kr/channel/epg/channelScheduleListInfo.do', {
                    jar: jar,
                    headers: {
                        'User-Agent': ua,
                    },
                    form: {
                        area: 'detail',
                        date_type: 'now',
                        airdate: date.format('YYYY-MM-DD'),     // 2017-05-08
                        pk_epg_mapp: '',
                        fd_mapp_cd: genreId,                    // 4003
                        fd_channel_id: channel.fd_channel_id,   // 798
                        searchColumn: '',
                        searchString: '',
                        selectString: '',
                    },
                    json: true
                });

                res.body.scheduleListIn.forEach(schedule => {
                    var start = moment(schedule.starttime + '+0900', 'YYYYMMDDHHmmssZ');
                    if (start.diff(date) < 0)
                        return;

                    programs.push({
                        start: start,
                        end: moment(schedule.endtime + '+0900', 'YYYYMMDDHHmmssZ'),
                        title: entities.decodeHTML(schedule.program_name),
                        subtitle: schedule.program_subname ? entities.decodeHTML(schedule.program_subname) : null,
                        category: schedule.program_category1,
                        episode: schedule.episode_id ? schedule.episode_id + '회' : null,
                        rebroadcast: schedule.rebroad,
                        desc: schedule.summary ? entities.decodeHTML(schedule.summary) : null,
                        rating: schedule.grade
                    });
                });

                date.add(1, 'days');
            }

            channels[channelName] = {
                icon: 'http:' + channel.fd_logo_path,
                group: genres[genreId], // genres[channel.fd_genre_name],
                programs: programs
            };
        }
    }

    return channels;
}

module.exports = {
    name: 'skylife',
    grab: grab
}

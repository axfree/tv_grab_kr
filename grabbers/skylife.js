#!/usr/bin/env node

'use strict';

var moment    = require('moment-timezone');
var entities  = require("entities");
var request   = require("co-request").defaults({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36'
    },
    agentOptions: {
        rejectUnauthorized: false
    }
});

// channelGroups:
//   UHD
//   skyTV
//   지상파/종편
//   연예/오락
//   음악
//   드라마
//   경제/보도
//   스포츠
//   영화
//   외국시리즈
//   생활/레저/취미
//   교양/정보/다큐
//   어린이/만화
//   홈쇼핑/T커머스
//   종교
//   공공/공익
//   해외
//   유료/PPV
//   오디오

function *grab(config, argv) {
    var channels = {};

    var date = moment.tz('Asia/Seoul').startOf('day');
    for (var d = 0; d < 2; d++) {
        var ymd = date.format('YYYYMMDD');
        var res = yield request.get(`https://www.skylife.co.kr/api/api/public/tv/schedule/${ymd}?0=${ymd}`, {
            json: true
        });

        for (var genre of res.body) {
            if (argv.listChannelGroup) {
                console.log(`skylife:${genre.name}`);
                continue;
            }

            for (var channel of genre.channels) {
                // {
                //     "id": "797",
                //     "name": "MBC",
                //     "number": "11",
                //     "logoUrl": "/upload/channel/201903/MBC_logo.png",
                //     "homepage": "http://www.imbc.com",
                //     "phone": "02-780-0011",
                //     "description": "콘텐츠 중심의 미디어",
                //     "programs": [
                //         ...
                //     ]
                // },

                var channelName = channel.name;
                var channelFullName = `skylife:${genre.name}:${channelName}`;
                if (argv.listChannels) {
                    console.log(channelFullName);
                    continue;
                }

                if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
                    continue;

                if (argv.debug)
                    console.log(channelFullName);

                if (d == 0) {
                    channels[channelName] = {
                        icon: 'https://static.skylife.co.kr' + channel.logoUrl,
                        number: channel.number,
                        group: genre.name,
                        programs: []
                    };
                }

                for (var program of channel.programs) {
                    var start = moment(program.startTime + '+0900', 'YYYYMMDDHHmmssZ');
                    if (start.diff(date) < 0)
                        continue;

                    // {
                    //     "id": "R111158706",
                    //     "name": "배드 앤 크레이지",
                    //     "mainCategory": "드라마",
                    //     "subCategory": "액션",
                    //     "cast": "이동욱,위하준,한지은,차학연,성지루,원현준,이상홍",
                    //     "summary": "유능하지만 '나쁜 놈' 수열이 정의로운 '미친 놈' K를 만나 겪게 되는 인성회복 히어로 드라마",
                    //     "grade": "15",
                    //     "startTime": "20211217224500",
                    //     "endTime": "20211218002300",
                    //     "rebroad": false,
                    //     "live": false,
                    //     "multiplexVoice": false,
                    //     "dvs": false,
                    //     "cc": true,
                    //     "suhwa": false
                    // },

                    channels[channelName].programs.push({
                        start: start,
                        end: moment(program.endTime + '+0900', 'YYYYMMDDHHmmssZ'),
                        title: entities.decodeHTML(program.name),
                        // subtitle: program.program_subname ? entities.decodeHTML(program.program_subname) : null,
                        // category: `${program.mainCategory} > ${program.subCategory}`,
                        category: program.mainCategory,
                        // episode: program.episode_id ? program.episode_id + '회' : null,
                        rebroadcast: program.rebroad,
                        desc: program.summary ? entities.decodeHTML(program.summary) : null,
                        rating: +program.grade
                    });
                }
            }
        }

        date.add(1, 'days');
    }

    return channels;
}

module.exports = {
    name: 'skylife',
    grab: grab
}

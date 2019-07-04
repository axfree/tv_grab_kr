'use strict';

var moment    = require('moment');
var request   = require("co-request").defaults({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.1 Safari/605.1.15'
    }
});

// channelGroups:
//   CJ ENM
//   뉴스/재테크
//   다큐/정보
//   드라마
//   스포츠/취미
//   여성/홈쇼핑
//   영화
//   음악/오락
//   지상파
//   캐릭터TV

function *grab(config, argv) {
    var res = yield request.get('http://api.tving.com/v1/media/lives', {
        qs: {
            // callback: 'jQuery112309728972763131998_1557552964981',
            pageNo: 1,
            pageSize: 100,
            order: 'chno',
            // order: 'rating',
            adult: 'all',
            free: 'all',
            guest: 'all',
            scope: 'all',
            channelType: 'CPCS0100', // 전체
            // channelType: 'CPCS0300', // 정주행채널
            screenCode: 'CSSD0100',
            networkCode: 'CSND0900',
            osCode: 'CSOD0900',
            teleCode: 'CSCD0900',
            apiKey: '1e7952d0917d6aab1f0293a063697610',
            _: Date.now()
        },
        json: true
    });

    var liveChannels = res.body.body.result;
    liveChannels.sort((a, b) => a.schedule.channel.category_name.ko.localeCompare(b.schedule.channel.category_name.ko));

    var channels = {};
    var lastChannelGroup = 'X';
    for (var lc of liveChannels) {
        var channelGroup = lc.schedule.channel.category_name.ko;
        if (argv.listChannelGroup) {
            if (channelGroup != lastChannelGroup) {
                console.log(`tving:${channelGroup}`);
                lastChannelGroup = channelGroup;
            }
            continue;
        }

        var channelName = lc.schedule.channel.name.ko;
        var channelNumber = lc.schedule.channel.stick_channel_no;
        var channelCode = lc.live_code;
        var channelIcon = lc.schedule.channel.image[0].url;
        var channelFullName = `tving:${channelGroup}:${channelName}`;

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
        console.log(channelFullName);

        var programs = [];
        var date = moment().utcOffset(9).startOf('day');

        for (var d = 0; d < Math.min(3, config.days); d++) {
            var res = yield request.get(`http://api.tving.com/v1/media/schedules/${channelCode}/${date.format('YYYYMMDD')}`, {
                qs: {
                    // callback: 'jQuery112308972937543476962_1561916198156',
                    pageNo: 1,
                    pageSize: 200,
                    order: '',
                    scope: 'all',
                    adult: '',
                    free: '',
                    broadcastDate: date.format('YYYYMMDD'),     // '20190701',
                    broadTime: date.format('YYYYMMDDHHmmss'),   // '20190701030252',
                    channelCode: channelCode,   // 'C00551',
                    screenCode: 'CSSD0100',
                    networkCode: 'CSND0900',
                    osCode: 'CSOD0900',
                    teleCode: 'CSCD0900',
                    apiKey: '1e7952d0917d6aab1f0293a063697610',
                    _: Date.now()
                },
                json: true
            });

            for (var sc of res.body.body.result) {
                var data = sc.program || sc.movie;
                if (!data) {
                    console.error(sc);
                    continue;
                }
                var program = {
                    start: moment(sc.broadcast_start_time, 'YYYYMMDDHHmmss'),
                    end: moment(sc.broadcast_end_time, 'YYYYMMDDHHmmss'),
                    title: data.name.ko,
                    // subtitle: m[3],
                    rebroadcast: sc.rerun_yn == 'Y',
                    icon: `http://stillshot.tving.com/thumbnail/${channelCode}_0_320x180.jpg`
                };

                if (program.start.diff(date) < 0 && programs.length != 0)
                    continue;

                if (sc.episode)
                    program.episode = sc.episode.frequency + '회';

                if (data.grade_code == 'CPTG0500')
                    program.rating = 19;
                else if (data.grade_code == 'CPTG0400')
                    program.rating = 15;
                else if (data.grade_code == 'CPTG0300')
                    program.rating = 12;

                programs.push(program);
            }

            date.add(1, 'day');
        }

        channels[channelName] = {
            icon: 'http://image.tving.com' + channelIcon,
            group: channelGroup,
            programs: programs
        };
    }

    return channels;
}

module.exports = {
    name: 'tving',
    grab: grab
}

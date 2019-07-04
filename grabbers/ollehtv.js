#!/usr/bin/env node

'use strict';

var $         = require('cheerio');
var moment    = require('moment-timezone');
var iconv     = require('iconv-lite');
var request   = require("co-request").defaults({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36'
    },
    agentOptions: {
        secureProtocol: 'TLSv1_method'
    }
});

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
//   otm:
//     종편/EBS/홈쇼핑
//     오락/음악/영화
//     뉴스/경제
//     2017 프로야구
//     스포츠/레져
//     애니/유아/교육
//     다큐/교양
//     성인 유료채널
//     가이드

var channelTypes = { 1:'otl', 2:'ots', 3:'otl-uhd', 4:'ots-uhd' };

function *grab(config, argv) {
    var channels = {};

    // otl, ots
    for (var channelType of Object.keys(channelTypes)) {
        var channelGrabber = channelTypes[channelType];
        var res = yield request.post('https://tv.kt.com/', {
            form: {
                parent_menu_id: 0,
                service_ch_no: '',
                view_type: '',
                view_dt: '',
                ch_type: channelType,
                product_cd: '',
                option_cd_list_0: '',
                option_cd_list_1: '',
                search_word: ''
            },
            encoding: null
        });

        var as = $('.tab_btns > a', iconv.decode(res.body, 'cp949'));
        for (var a of as.get()) {
            var channelGroup = $(a).text();
            var channelGroupId = +$(a).attr('onclick').match(/'(\d+)'\);$/) [1];    // fnSelChannel('chTab2','1');
            if (channelGroupId == 0)   // 전체
                continue;

            if (argv.listChannelGroup) {
                console.log(`${channelGrabber}:${channelGroup}`);
                continue;
            }

            var res = yield request.post('https://tv.kt.com/tv/channel/pChList.asp', {
                form: {
                    ch_type: channelType,           // 2
                    parent_menu_id: channelGroupId, // 1
                    product_cd: '',
                    option_cd_list: '',
                },
                encoding: null
            });

            var spans = $('span.ch', iconv.decode(res.body, 'cp949'));
            for (var span of spans.get()) {
                var m = $(span).text().trim().match(/(\d+)\u00a0(.*)$/);
                var channelNumber = m[1];
                var channelName = decodeURIComponent(m[2]);
                var channelFullName = `${channelGrabber}:${channelGroup}:${channelName}`;

                if (argv.listChannels) {
                    console.log(channelFullName);
                    continue;
                }

                if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
                    continue;

                console.log(channelFullName);

                var programs = [];
                var date = moment.tz('Asia/Seoul').startOf('day');
                for (var d = Math.min(7, config.days); d > 0; d--) {
                    var res = yield request.post('https://tv.kt.com/tv/channel/pSchedule.asp', {
                        form: {
                            ch_type: channelType,               // 1
                            service_ch_no: channelNumber,       // 5
                            view_type: 1,
                            seldate: date.format('YYYYMMDD'),   // 20171106
                        },
                        encoding: null
                    });

                    var trs = $('.tb_schedule > tbody > tr', iconv.decode(res.body, 'cp949'));
                    trs.each((idx, tr) => {
                        var tds = $('td', tr);
                        var h = $(tds).eq(0).text();
                        var ps = $(tds).eq(2).find('p');
                        ps.each((idx, p) => {
                            var program = {
                                start: moment(date).hours(+h).minutes(+tds.eq(1).find('p').eq(idx).text()),
                                title: $(p).text().trim().replace(/%26amp;/g, '&'),
                                category: tds.eq(3).find('p').eq(idx).text()
                            };
                            // if ($(p).text().includes('%')/* && !$(p).text().includes('amp;')*/)
                            //     console.log('********************* ' + $(p).text());
                            var ratingMatches = $(p).find('img').eq(0).attr('alt').match(/(\d+)세 이상/);
                            if (ratingMatches)
                                program.rating = +ratingMatches[1];

                            programs.push(program);
                        })
                    });

                    date.add(1, 'days');
                }

                channels[channelName] = {
                    icon: channelGrabber.startsWith('otl') ? `https://tv.kt.com/relatedmaterial/ch_logo/live/${channelNumber}.png`  // 80x30
                                                           : `https://tv.kt.com/relatedmaterial/ch_logo/skylife/ch_${channelNumber}.png`,
                    group: channelGroup,
                    programs: programs
                };
            }
        }
    }

    // otm
    var channelGrabber = 'otm';
    var res = yield request.get('http://menu.megatvdnp.co.kr:38086/app6/api/epg_ch_category?istest=0%7D&main_view_yn=A', {
        headers: {
            'User-Agent': 'OMS(compatible;ServiceType/OTM;DeviceType/Android;DeviceModel/Nexus5;OSType/Android;OSVersion/6.0;AppVersion/5.5.4)'
        },
        json: true
    });

    for (var cat of res.body.data.list) {
        var channelGroup = cat.category_name;
        if (/전체|인기|오디오|5G채널/.test(channelGroup))
            continue;

        if (argv.listChannelGroup) {
            console.log(`${channelGrabber}:${channelGroup}`);
            continue;
        }

        var res = yield request.get(`http://menu.megatvdnp.co.kr:38086/app6/api/epg_chlist?istest=0&category_id=${cat.category_id}`, {
            headers: {
                'User-Agent': 'OMS(compatible;ServiceType/OTM;DeviceType/Android;DeviceModel/Nexus5;OSType/Android;OSVersion/6.0;AppVersion/5.5.4)'
            },
            json: true
        });

        for (var ch of res.body.data.list[0].list_channel) {
            if (ch.type != 'EPG' && ch.type != 'SHOP')
                continue;

            var channelNumber = ch.ch_no;
            var channelName = ch.service_ch_name.replace(/ \(데이터프리\)/, '');
            var channelIcon = ch.ch_image_list;
            var channelFullName = `${channelGrabber}:${channelGroup}:${channelName}`;

            if (argv.listChannels) {
                console.log(channelFullName);
                continue;
            }

            if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
                continue;

            console.log(channelFullName);

            var res = yield request(`http://menu.megatvdnp.co.kr:38086/app6/api/epg_proglist?istest=&ch_no=${channelNumber}`, {
                headers: {
                    'User-Agent': 'OMS(compatible;ServiceType/OTM;DeviceType/Android;DeviceModel/Nexus5;OSType/Android;OSVersion/6.0;AppVersion/5.5.4)'
                },
                json: true
            });

            var programs = [];
            var date = moment.tz('Asia/Seoul');
            res.body.data.list.forEach((prog, idx) => {
                var start = moment(date.format('YYYYMMDD') + prog.start_time + '+0900', 'YYYYMMDDHH:mmZ');
                var end = moment(date.format('YYYYMMDD') + prog.end_time + '+0900', 'YYYYMMDDHH:mmZ');
                if (start.diff(end) > 0) {
                    if (idx == 0)
                        start.add(-1, 'days');
                    else
                        end.add(1, 'days');
                }
                var program = {
                    title: decodeURIComponent(prog.program_name.replace(/\+/g, ' ')).replace(/^방송중 /, ''),
                    subtitle: decodeURIComponent(prog.program_subname.replace(/\+/g, ' ')),
                    start: start,
                    end: end,
                    episode: prog.frequency ? prog.frequency + '회' : null,
                    rebroadcast: (prog.rebroad == 'Y'),
                    rating: +prog.rating,
                    directors: prog.director,
                    actors: prog.cast
                };

                if (program.subtitle) {
                    var subtitleIndex = program.title.lastIndexOf(program.subtitle);
                    if (subtitleIndex > 0)
                        program.title = program.title.substring(0, subtitleIndex).trim();

                    program.subtitle = program.subtitle.replace(/^<(.*?)(>)?$/, (m, st, r) => r ? st : st.trim() + '...');
                }

                programs.push(program);
            });

            channels[channelName] = {
                icon: channelIcon,
                group: channelGroup,
                programs: programs
            };
        }
    }

    return channels;
}

module.exports = {
    name: 'ollehtv',
    grab: grab
}

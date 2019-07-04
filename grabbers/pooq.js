'use strict';

var moment    = require('moment');
var request   = require("co-request").defaults({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.1 Safari/605.1.15'
    }
});

// channelGroups:
//   지상파
//   종편/보도
//   홈쇼핑
//   드라마/예능
//   영화
//   애니
//   키즈
//   다큐
//   스포츠
//   라디오/음악

function *grab(config, argv) {
    var res = yield request.get('https://apis.pooq.co.kr/live/genrechannels?apikey=E5F3E0D30947AA5440556471321BB6D9&device=pc&partner=pooq&region=kor&targetage=auto&credential=none&pooqzone=none&drm=wm&free=all', {
        json: true
    });

    var channels = {};
    for (var genre of res.body.list) {
        var channelGroup = genre.genretitle;

        if (argv.listChannelGroup) {
            console.log(`pooq:${channelGroup}`);
            continue;
        }

        for (var channel of genre.list) {
            var channelName = channel.channelname;
            var channelId = channel.channelid;
            var channelThumb = channel.image;
            var channelFullName = `pooq:${channelGroup}:${channelName}`;

            if (argv.listChannels) {
                console.log(channelFullName);
                continue;
            }

            if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
                continue;

            console.log(channelFullName);

            var programs = [];
            var date = moment().utcOffset(9).startOf('day');
            var res = yield request.get(`https://apis.pooq.co.kr/live/epgs/channels/${channelId}`, {
                qs: {
                    apikey: 'E5F3E0D30947AA5440556471321BB6D9',
                    device: 'pc',
                    partner: 'pooq',
                    region: 'kor',
                    targetage: 'auto',
                    credential: 'none',
                    pooqzone: 'none',
                    drm: 'wm',
                    startdatetime: date.format('YYYY-MM-DD HH:mm'),                                 // '2019-07-03 02:55',
                    enddatetime: moment(date).add(config.days, 'days').format('YYYY-MM-DD HH:mm'),  // '2019-07-04 02:55',
                    offset: 0,
                    limit: 999,
                    orderby: 'old'
                },
                json: true
            });

            for (var p of res.body.list) {
                // 네트워크 문화특선\n올댓뮤직\n[춘천총국]
                // 중계방송 \n국회 교섭단체 대표연설
                var program = {
                    start: moment(p.starttime + '+0900', 'YYYY-MM-DD HH:mmZ'),
                    end: moment(p.endtime + '+0900', 'YYYY-MM-DD HH:mmZ'),
                    rating: +p.targetage || null,
                    title: p.title.replace(/\s+/g, ' ').trim(),
                    icon: channelThumb
                };

                program.title = program.title
                    .replace(/\s*\((재)?(?:, )?(\d+회)?\)/, (m, p1, p2) => {
                        // 수목미니시리즈 봄밤(25회)
                        // 수목미니시리즈 봄밤(재, 23회)
                        // 역사채널e(수)(재) [목판 보존의 진수 해인사 장경판전]
                        if (p1)
                            program.rebroadcast = true;
                        if (p2)
                            program.episode = p2;
                        return '';
                    })
                    .replace(/\s*(\d+)(?:[~](\d+))?회/, (m, p1, p2) => {
                        // 찰떡콤비 3회(재)
                        // 동아컬렉션 722회 제 8회 타이실크 패션쇼 4
                        // 심야식당 시즌2 1~2회
                        program.episode = p1 + '회';
                        return '';
                    })
                    .replace(/\s*\[(시즌\d+ )?(\d+)[화|회][\s\-]*(.*?)\]/, (m, p1, p2, p3) => {
                        // 생방송 판다다 [288화 두려움, 가라!]
                        // 명령이다, 비트!(전주재방) [19화 정동진행 기차를 타라]
                        // 생방송 톡!톡! 보니 하니1 [3896회]
                        // 예술아 놀자 [시즌2 4화 - 내 마음대로 오케스트라]
                        program.episode = p2 + '회';
                        if (p3)
                            program.subtitle = p3;
                        return p1 ? ' ' + p1 : '';
                    })
                    .replace(/(\s+시즌\d+) (\d+)/, (m, p1, p2) => {
                        // 고독한 미식가 시즌3 5
                        program.episode = p2 + '회';
                        return p1;
                    })
                    .trim();

                programs.push(program);
            }

            channels[channelName] = {
                icon: `http://img.pooq.co.kr/BMS/Channelimage30/image/${channelId}.jpg`,
                group: channelGroup,
                programs: programs
            };
        }
    }

    return channels;
}

module.exports = {
    name: 'pooq',
    grab: grab
}

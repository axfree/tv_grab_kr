#!/usr/bin/env node

var co        = require("co");
var request   = require("co-request");
var XMLWriter = require('xml-writer');
var pd        = require('pretty-data').pd;
var minimist  = require('minimist');
var fs        = require('fs');
var net       = require('net');
var $         = require('cheerio');
var moment    = require('moment-timezone');
var iconv     = require('iconv-lite');

// channelGroups:
//   지상파
//   스포츠/취미
//   영화
//   뉴스/경제
//   교양/다큐
//   여성/오락
//   어린이/교육
//   홈쇼핑
//   공공/종교

var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';
var userHome = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];

var config = {
    channelFilters: [                   // 'broadcastType:channelGroup:channelName'
        // '어린이/교육',
        // 'SBS$',
        // '사이언스TV',
        // /JTBC$/i,
    ],
    days: 2,        // supply data for X days
    offset: 0       // start with data for day today plus X days
};

[ "/etc/tv_grab_kr.conf", "/etc/config/tv_grab_kr.conf", "~/.tv_grab_kr" ].forEach(function (file) {
    try {
        var conf = JSON.parse(fs.readFileSync(file.replace(/^~/, userHome)));
        for (var k in conf) {
            if (k == 'channelFilters') {
                conf[k].forEach((re, idx) => {
                    conf[k][idx] = new RegExp(re);
                });
            }
            config[k] = conf[k];
        }
    }
    catch (err) {
        if (err.code != 'ENOENT') throw err;
    }
});

var argv = minimist(process.argv.slice(2), {
    alias: {
        'list-channel-group': 'l',
        'list-channels': 'c',
        'channel-filters': 'g',
        'help': 'h',
        // baseline options
        'days': 'n',
        'offset': 'o',
        'output': 'w',
        'sock': 's',
        'description': 'd',
        'version': 'v'
    }
});

co(function* () {
    if (argv.h) {
        console.log(
            'Usage: node tv_grab_tvg.js [OPTION]\n' +
            'Options:\n' +
            '  -g, --channel-filter=regex  select only channels matching regular expression\n' +
            '  -h, --help                  show usage information\n' +
            '  -l, --list-channel-group    list all available channel group\n' +
            '  -c, --list-channels         list all available channels\n' +
            '  -n, --days=X                supply data for X days\n' +
            '  -o, --offset=X              start with data for day today plus X days\n' +
            '  -w, --output=FILENAME       redirect xmltv output to the specified file\n' +
            '  -s, --sock=SOCKET           redirect xmltv output to the specified XMLTV socket\n'
        );

        return 0;
    }

    // tv_grab --description option
    if (argv.description) {
        console.log('tv_grab_tvg grabber by axfree');
        return 0;
    }

    // tv_grab --capabilities option
    if (argv.capabilities) {
        console.log('baseline');
        return 0;
    }

    // tv_grab --days option
    if (argv.days) {
        config.days = argv.days;
    }

    // tv_grab --offset option
    if (argv.offset) {
        config.offset = argv.offset;
    }

    // tv_grab --output option
    if (argv.output) {
        config.output = argv.output;
    }

    // tv_grab v option
    if (argv.version) {
        console.log('0.1');
        return 0;
    }

    // tv_grab --output option
    if (argv.sock) {
        config.sock = argv.sock;
    }

    if (argv.g) {
        config.channelFilters = Array.isArray(argv.g) ? argv.g : [ argv.g ];
        config.channelFilters.forEach((re, idx) => {
            config.channelFilters[idx] = new RegExp(re);
        });
    }

    var res = yield request.get('https://www.uplus.co.kr/css/chgi/chgi/RetrieveTvContentsMFamily.hpi', {
        headers: {
            'User-Agent': ua,
        },
        encoding: null,
    });

    var channels = [];
    var channelGroupsAs = $('#CATEGORY > ul > li > a', iconv.decode(res.body, 'cp949'));
    for (var a of channelGroupsAs.get()) {
        var channelGroup = $(a).text();
        if (argv.c) {
            console.log(`tvG:${channelGroup}`);
            continue;
        }

        var m = $(a).attr('onclick').match(/'(\d+)','(\d+)','(\d+)'/);
        var res = yield request.post('https://www.uplus.co.kr/css/chgi/chgi/RetrieveTvChannel.hpi', {
            headers: {
                'User-Agent': ua,
            },
            encoding: null,
            form: {
                code: m[2],
                category: m[1]
            },
        });

        var channelAs = $('li > a', iconv.decode(res.body, 'cp949'));
        for (var a of channelAs.get()) {
            var m = $(a).text().match(/(.*)\(Ch\.(\d+)\)/);
            var channelName = m[1].replace(/-Full HD$/, '')
                                  .replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1')
                                  .replace(/^MBC(경남)/, 'MBC $1')
                                  .replace(/^(진주)MBC/, 'MBC $1');
            var channelNumber = m[2];
            var channelFullName = `tvG:${channelGroup}:${channelName}`;
            var channelCode = $(a).attr('onclick').match(/'(\d+)','(\d+)'/) [1];

            if (argv.l) {
                console.log(`tvG:${channelGroup}:${channelName}`);
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
            var date = moment.tz('Asia/Seoul').startOf('day');
            do {
                var res = yield request.post('https://www.uplus.co.kr/css/chgi/chgi/RetrieveTvSchedule.hpi', {
                    headers: {
                        'User-Agent': ua,
                    },
                    encoding: null,
                    form: {
                        chnlCd: channelCode,
                        evntCmpYmd: date.format('YYYYMMDD')
                    },
                });
                var body = iconv.decode(res.body, 'cp949');
                var nextLink = $('a.next', body);

                var trs = $('tbody > tr', body);
                trs.each((idx, tr) => {
                    var startTime = $('td:nth-child(1)', tr).text();    // 23:10
                    var title = $('td:nth-child(2)', tr).text().trim();
                    var program = {
                        tm: moment(date.format('YYYYMMDD') + startTime + '+0900', 'YYYYMMDDHH:mmZ'),
                        category: $('td:nth-child(3)', tr).text().trim(),
                        rating: 0
                    }

                    $('img', tr).each((idx, img) => {
                        var alt = $(img).attr('alt');
                        var m = alt.match(/(\d+)세이상 관람가/);
                        if (m)
                            rating = parseInt(m[1]);
                    })

                    // (생) [포르투갈:웨일스] UEFA 유로 2016 준결승
                    // 국내특선다큐 [디지털 콘텐츠, 공짜와의 전쟁 2부]
                    // 청년창업 RUNWAY [친환경 유아용품 전문 브랜드 최..
                    // Smartest Guy In The Room (S1) (9,10회)
                    // 방송 정보 없음

                    // fix unbalanced parenthesis/brackets
                    if (title.endsWith('..')) {
                        var fixedTitle = '';
                        var opens = [];
                        var openers = '([{<';
                        var closers = ')]}>';
                        for (var c of title) {
                            var idx = openers.indexOf(c);
                            if (idx >= 0)
                                opens.push(idx);
                            else {
                                idx = closers.indexOf(c);
                                if (idx >= 0) {
                                    if (opens.length == 0 || opens[opens.length - 1] != idx)
                                        c = openers[idx] + c;
                                    else
                                        opens.pop();
                                }
                            }
                            fixedTitle += c;
                        }
                        opens.reverse().forEach(idx => fixedTitle += closers[idx]);

                        if (title != fixedTitle) {
                            // console.log(`title changed: old=${title}, new=${fixedTitle}`);
                            title = fixedTitle;
                        }
                    }

                    //                    1                2              3:title        4                5
                    var m = title.match(/^(\(생\))?(?:\s*\[(.*?)\])?(?:\s*(.*?))?(?:\s*\[(.*?)\])?(?:\s*\(([\d,]+회)\))?$/);
                    if (m) {
                        program.tm = moment(date.format('YYYYMMDD') + startTime + '+0900', 'YYYYMMDDHH:mmZ');
                        if (m[3]) {
                            program.title = m[3];
                            program.subTitle = m[2] || m[4];
                        }
                        else
                            program.title = m[2] || m[4];
                        program.isLive = !!m[4];
                        program.episode = m[5];
                    }

                    // if (!program.title) {
                    //     console.error(channelFullName, title, program.title);
                    //     process.exit(0);
                    // }

                    programs.push(program);
                });

                date.add(1, 'days');
            }
            while (nextLink.length > 0);

            channels[channelName] = {
                icon: '',
                group: channelGroup,
                programs: programs
            };
        }
    }

    if (argv.l || argv.c)
        return 0;

    var doc = new XMLWriter;
    doc.startDocument('1.0', 'UTF-8');
    doc.startElement('tv').writeAttribute('source-info-name', 'EPGI')
                          .writeAttribute('generator-info-name', 'tv_grab_tvg')
                          .writeAttribute('generator-info-url', 'mailto:tvgrab.kr@gmail.com');
    // add channels first
    for (var channelName in channels) {
        var channel = channels[channelName];
        var ch = new XMLWriter;
        ch.startElement('channel').writeAttribute('id', channelName)
                                  .writeElement('display-name', channelName)
                                  .writeElement('display-name', `tvG:${channel.group}:${channelName}`);
        doc.writeRaw(ch);
    }

    // add programs later
    var startDate = moment().startOf('day').add(config.offset, 'days');
    var endDate = moment(startDate).add(config.days, 'days');

    for (var channelName in channels) {
        var programs = channels[channelName].programs;

        programs.forEach(function (program, idx) {
            if (program.title == '방송 정보 없음') {
                console.log(`** 방송 정보 없음`);
                return;
            }

            var start = program.tm;
            var end;
            var nextProgram = programs[idx + 1];
            if (nextProgram)
                end = nextProgram.tm;
            else {
                console.error(`** no next program: ${channelName}`);
                end = moment(start).add(1, 'hours');
            }

            if (start.diff(startDate) < 0 || start.diff(endDate) >= 0) {
                // console.log('skip', program.tm.format());
                return;
            }

            var prog = new XMLWriter;
            prog.startElement('programme').writeAttribute('start', start.format("YYYYMMDDHHmmss Z").replace(':', ''))
                                          .writeAttribute('stop', end.format("YYYYMMDDHHmmss Z").replace(':', ''))
                                          .writeAttribute('channel', channelName)
                                          .writeElement('language', 'kr')
                                          .startElement('title').writeAttribute('lang', 'kr').text(program.title).endElement();
            if (program.subTitle)
                prog.startElement('sub-title').writeAttribute('lang', 'kr').text(program.subTitle).endElement();

            if (program.category)
                prog.startElement('category').writeAttribute('lang', 'kr').text(program.category).endElement();

            if (program.episode)
                prog.startElement('episode-num').writeAttribute('system', 'onscreen').text(program.episode).endElement();

            // if (program.rebroad == 'Y')
            //     prog.startElement('previously-shown').endElement();

            // if (program.summary)
            //     prog.startElement('desc').writeAttribute('lang', 'kr').text(program.summary).endElement();

            prog.startElement('rating').writeAttribute('system', 'VCHIP')
                                       .writeElement('value', (program.rating == 0) ? '모든 연령 시청가' : program.rating + '세 이상 시청가');
            prog.endElement();

            doc.writeRaw(prog);
        })
    }

    doc.endElement();
    doc.endDocument();

    if (config.output) {
        fs.writeFile(config.output, pd.xml(doc.toString()), function (err) {
            if (err)
                throw err;
        })
    }
    else if (config.sock) {
        var client = net.connect( {path: config.sock}, function () {
            client.write(doc.toString());
            client.end();
            client.unref();
        })
    }
    else {
        console.log(pd.xml(doc.toString()));
    }

    return 0;

}).catch(function (err) {
    console.error(err.stack);
});

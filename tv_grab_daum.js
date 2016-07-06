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

var broadcastTypes = [ '지상파', '종합편성', '케이블', '스카이라이프', '해외위성', '라디오' ];
var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';
var userHome = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];

var config = {
    channelFilters: [                   // 'broadcastType:channelGroup:channelName'
        /지상파|종합편성|케이블|해외위성/,
        // /케이블:영화/,
        // /종합편성::(?!TV조선)/,
        // /케이블:교양\/정보:산업방송 채널i/,
        // /케이블:연예\/오락:tvN/,
        // /산업방송 채널i/,
        // /(SBS|KBS[1-2]|MBC)$/,
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
            'Usage: node tv_grab_daum.js [OPTION]\n' +
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
        console.log('tv_grab_kr grabber by axfree');
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

    if (argv.l || argv.c) {
        for (var broadcastType of broadcastTypes) {
            var res = yield request.get('http://search.daum.net/search', {
                headers: {
                    'User-Agent': ua,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.8,ko;q=0.6',
                },
                qs: { w:'tot', q: broadcastType + ' 편성표' },
            });

            var channelULs = $('.layer_tv ul', res.body);
            if (channelULs.length == 0) // 종합편성
                channelULs = $('#channelNaviLayer', res.body);

            channelULs.each((idx, ul) => {
                var channelGroup = $(ul).parent().find('strong').text().trim();
                var channelAs = $('a', ul);
                if (argv.c) {
                    console.log(`${broadcastType}:${channelGroup}`);
                }
                else {
                    channelAs.each((idx, a) => {
                        var channelName = $(a).text().trim().replace(/^HD /, '')
                                                            .replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1')
                                                            .replace(/^MBC(경남)/, 'MBC $1')
                                                            .replace(/^(진주)MBC/, 'MBC $1');
                        var channelFullName = `${broadcastType}:${channelGroup}:${channelName}`;
                        console.log(channelFullName);
                    });
                }
            })
        }

        return 0;
    }

    var schedules = {};
    for (var broadcastType of broadcastTypes) {
        var res = yield request.get('http://search.daum.net/search', {
            headers: {
                'User-Agent': ua,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.8,ko;q=0.6',
            },
            qs: { w:'tot', q: broadcastType + ' 편성표' },
        });

        var channelULs = $('.layer_tv ul', res.body);
        if (channelULs.length == 0) // 종합편성
            channelULs = $('#channelNaviLayer', res.body);

        // channelsAs = $('<a>ocn</a>');
        for (var ul of channelULs.get()) {
            var channelGroup = $(ul).parent().find('strong').text().trim();
            var channelAs = $('a', ul);

            for (var a of channelAs.get()) {
                var channelName = $(a).text().trim().replace(/^HD /, '')
                                                    .replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1')
                                                    .replace(/^MBC(경남)/, 'MBC $1')
                                                    .replace(/^(진주)MBC/, 'MBC $1');
                var channelFullName = `${broadcastType}:${channelGroup}:${channelName}`;
                if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
                    continue;

                if (schedules[channelName]) {
                    // console.log(channelName, 'skip');
                    continue;
                }
                console.log(channelFullName);

                var res = yield request.get('http://search.daum.net/search' + $(a).attr('href'), {
                    headers: {
                        'User-Agent': ua,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.8,ko;q=0.6',
                    },
                });

                var startDateKST = moment.tz('Asia/Seoul').startOf('day').add(-1, 'days');
                // console.log(startDateKST.format('YYYYMMDDHHmmss Z'));

                var programs = [];
                var scheduleTable = $('.wrap_tbl', res.body);
                for (var d = 0; d < 8; d++) {
                    // console.log(startDateKST.format());
                    for (var h = 0; h < 24; h++) {
                        var dls = $(`td#channelBody${h}_${d} dl`, scheduleTable);
                        dls.each((idx, dl) => {
                            var m = $('dt', dl).text();
                            var program = {};
                            program.grade = 0;
                            program.tm = moment(startDateKST).hours(h).minutes(m);
                            // console.log(program.tm.format('YYYYMMDDHHmmss Z'));
                            var titles = $('dd', dl).children();
                            titles.each((idx, c) => {
                                var text = $(c).text().trim();
                                if (idx == 0) {
                                    var titleMatches = text.match(/^(.*?)(?: <(.*)>)?(?: (\d+회))?$/);
                                    if (titleMatches) {
                                        program.title = titleMatches[1];
                                        if (titleMatches[2])
                                            program.subtitle = titleMatches[2];
                                        if (titleMatches[3])
                                            program.episode = titleMatches[3];
                                    }
                                    else {
                                        program.title = text;
                                        console.error('title format error: title=' + text);
                                    }
                                }
                                else {
                                    if (text == '재방송')
                                        program.isRerun = true;
                                    else {
                                        var gradeMatch = text.match(/프로그램등급 (\d+)세/);
                                        if (gradeMatch)
                                            program.grade = parseInt(gradeMatch[1]);
                                    }
                                }
                            });

                            programs.push(program);
                        })
                    }

                    startDateKST.add(1, 'days');
                }

                schedules[channelName] = programs;
            }
        }
    }

    var doc = new XMLWriter;
    doc.startDocument('1.0', 'UTF-8');
    doc.startElement('tv').writeAttribute('source-info-name', 'EPGI')
                          .writeAttribute('generator-info-name', 'tv_grab_naver')
                          .writeAttribute('generator-info-url', 'mailto:tvgrab.kr@gmail.com');
    // add channels first
    for (var channelName in schedules) {
        var ch = new XMLWriter;
        ch.startElement('channel').writeAttribute('id', channelName)
                                  .writeElement('display-name', channelName)
                                  .startElement('icon')
                                      .writeAttribute('src', `http://23.94.11.84:3000/icon/skylife/${encodeURIComponent(channelName)}.png`)
                                  .endElement();
        doc.writeRaw(ch);
    }

    // add programs later
    var startDate = moment().startOf('day').add(config.offset, 'days');
    var endDate = moment(startDate).add(config.days, 'days');

    for (var channelName in schedules) {
        var programs = schedules[channelName];

        programs.forEach(function (program, idx) {
            if (program.tm.diff(startDate) < 0 || program.tm.diff(endDate) >= 0) {
                // console.log('skip', program.tm.format());
                return;
            }

            var prog = new XMLWriter;
            var start = program.tm;
            var end;
            var nextProgram = programs[idx + 1];
            if (nextProgram)
                end = nextProgram.tm;
            else {
                console.error(`** no next program: ${channelName}`);
                end = moment(start).add(1, 'hours');
            }

            prog.startElement('programme').writeAttribute('start', start.format("YYYYMMDDHHmmss Z").replace(':', ''))
                                          .writeAttribute('stop', end.format("YYYYMMDDHHmmss Z").replace(':', ''))
                                          .writeAttribute('channel', channelName)
                                          .startElement('title').writeAttribute('lang', 'kr').text(program.title).endElement()
                                          .startElement('sub-title').writeAttribute('lang', 'kr').text(program.subtitle || '').endElement()
                                          .writeElement('language', 'kr');
            // if (genres[program.largeGenreId])
            //     prog.startElement('category').writeAttribute('lang', 'kr').text(genres[program.largeGenreId]).endElement();
            // else {
            //     console.error('unknown genre ' + program.largeGenreId + ' for scheduleId ' + program.scheduleId);
            // }

            if (program.episode)
                prog.startElement('episode-num').writeAttribute('system', 'onscreen').text(program.episode).endElement();

            if (program.isRerun)
                prog.startElement('previously-shown').endElement();

            prog.startElement('rating').writeAttribute('system', 'VCHIP')
                                       .writeElement('value', (program.grade == 0) ? '모든 연령 시청가' : program.grade + '세 이상 시청가');
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

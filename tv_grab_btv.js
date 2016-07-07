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
//   종합편성채널
//   애니
//   키즈
//   영화
//   시리즈
//   드라마/예능
//   라이프
//   취미/레저
//   스포츠
//   교육
//   홈쇼핑
//   공공
//   연예/오락
//   종교
//   교양/정보
//   뉴스/경제
//   보도

var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';
var userHome = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];

var config = {
    channelFilters: [                   // 'broadcastType:channelGroup:channelName'
        // /채널J$/,
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
            'Usage: node tv_grab_btv.js [OPTION]\n' +
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
        console.log('tv_grab_btv grabber by axfree');
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

    var res = yield request.get('http://www.skbroadband.com/content/realtime/Realtime_List.do', {
        headers: {
            'User-Agent': ua,
        },
        encoding: null,
    });

    // console.log(iconv.decode(res.body, 'cp949'));
    var channels = [];
    var channelGroupsDIVs = $('.channal-list-inner', iconv.decode(res.body, 'cp949'));
    for (var div of channelGroupsDIVs.get()) {
        var channelGroup = $('h2 > a', div).text().trim();
        if (argv.c) {
            console.log(`btv:${channelGroup}`);
            continue;
        }

        var lis = $('ul > li', div);
        for (var li of lis.get()) {
            var channelNumber = $('em', li).text().match(/[(\d+)]/) [1];
            var a = $('a', li);
            var m = $(a).attr('onclick').match(/'(\d+)','(\d+)','(.*)','(.*)'/);
            var channelName = $(a).text().trim();
            var channelFullName = `btv:${channelGroup}:${channelName}`;

            if (argv.l) {
                console.log(`btv:${channelGroup}:${channelName}`);
                continue;
            }

            if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
                continue;

            if (channels[channelName]) {
                // console.log(channelName, 'skip');
                continue;
            }
            console.log(channelFullName);

            var res = yield request.post('http://www.skbroadband.com/content/realtime/Channel_List.do', {
                headers: {
                    'User-Agent': ua,
                },
                encoding: null,
                form: {
                    // retUrl:
                    pageIndex: 1,
                    // pack:(unable to decode value)
                    // tab_gubun:1
                    key_depth1: m[1],       // 5100,
                    key_depth2: m[2],       // 14,
                    key_depth3: m[3],
                    // key_chno:
                    key_depth2_name: m[4],  // SBS,
                    menu_id: 'C02010000',
                }
            });

            var programs = [];
            var date = moment.tz('Asia/Seoul').startOf('day');
            var trs = $('.uio-table-time tr', iconv.decode(res.body, 'cp949'));
            trs.each((h, tr) => {
                var tds = $('td', tr);
                tds.each((d, td) => {
                    var item = $(td).children().first();
                    while (item.length > 0) {
                        if (!item.text().match(/^\d{2}분$/))
                            break;

                        var program = {};
                        program.tm = moment(`${date.format('YYYYMMDD')}.${h}.${item.text()}+0900`, 'YYYYMMDD.H.mm분Z').add(d, 'days');
                        item = item.next();
                        $('span', item).each((idx, span) => {
                            if ($(span).hasClass('subject')) {
                                var title = $(span).text().trim();
                                // 미녀 공심이(16회)(재)
                                // 원티드<5회,6회>(재)
                                // TV 동물농장(재)
                                // 프리한 19(6회)<여행지19>(재)     # tvN
                                //                   1               2:episode               3:subtitle
                                var m = title.match(/(.*?)(?:\s*[\(<]([\d,회]+)[\)>])?(?:\s*<(.*?)>)?(\(재\))?$/);
                                if (m) {
                                    program.title = m[1];
                                    if (m[2])
                                        program.episode = m[2];
                                    if (m[3])
                                        program.subTitle = m[3];
                                    if (m[4])
                                        program.rebroadcast = true;
                                }
                            }
                            else {
                                var m = $(span).text().match(/^(\d+)$/);
                                if (m)
                                    program.rating = parseInt(m[1]);
                            }
                        });

                        programs.push(program);
                        item = item.next();
                    }
                });
            })

            programs.sort((a, b) => {
                return a.tm.diff(b.tm);
            });

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
                          .writeAttribute('generator-info-name', 'tv_grab_btv')
                          .writeAttribute('generator-info-url', 'mailto:tvgrab.kr@gmail.com');
    // add channels first
    for (var channelName in channels) {
        var channel = channels[channelName];
        var ch = new XMLWriter;
        ch.startElement('channel').writeAttribute('id', channelName)
                                  .writeElement('display-name', channelName)
                                  .writeElement('display-name', `btv:${channel.group}:${channelName}`);
        doc.writeRaw(ch);
    }

    // add programs later
    var startDate = moment().startOf('day').add(config.offset, 'days');
    var endDate = moment(startDate).add(config.days, 'days');

    for (var channelName in channels) {
        var programs = channels[channelName].programs;

        programs.forEach(function (program, idx) {
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

            if (program.rebroadcast)
                prog.startElement('previously-shown').endElement();

            // if (program.summary)
            //     prog.startElement('desc').writeAttribute('lang', 'kr').text(program.summary).endElement();

            if (program.rating)
                prog.startElement('rating').writeAttribute('system', 'VCHIP')
                                           .writeElement('value', program.rating + '세 이상 시청가');
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

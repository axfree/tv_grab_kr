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
            'Usage: node tv_grab_polaristv.js [OPTION]\n' +
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
        console.log('tv_grab_polaristv grabber by axfree');
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

    var channels = [];
    var channelName = '폴라리스TV';
    var channelGroup = '레저';

    if (argv.c) {
        console.log(`케이블:${channelGroup}`);
        return 0;
    }

    if (argv.l) {
        console.log(`케이블:${channelGroup}:${channelName}`);
        return 0;
    }

    var res = yield request.get('http://www.polaristv.co.kr/bbs/getSchedule.php?bo_table=qtone&wr_id=21', {
        headers: {
            'User-Agent': ua,
        },
        json: true,
    });

    var programs = [];
    var date = moment.tz('Asia/Seoul').startOf('isoWeek');  // this monday
    var data = res.body;
    for (var k in data) {
        var schedules = data[k];
        for (var t in schedules) {
            var schedule = schedules[t];
            var h = parseInt(t.split(':')[0]);
            var m = parseInt(t.split(':')[1]);
            var program = {};
            program.tm = moment(date).hours(h).minutes(m);
            if (h >= 0 && h < 6)
                program.tm.add(1, 'days');
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
                            program.subTitle = episodeMatches[1];
                        program.episode = episodeMatches[2] + '회';
                    }
                    else
                        program.subTitle = matches[2];
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

    if (argv.l || argv.c)
        return 0;

    var doc = new XMLWriter;
    doc.startDocument('1.0', 'UTF-8');
    doc.startElement('tv').writeAttribute('source-info-name', 'EPGI')
                          .writeAttribute('generator-info-name', 'tv_grab_polaristv')
                          .writeAttribute('generator-info-url', 'mailto:tvgrab.kr@gmail.com');
    // add channels first
    for (var channelName in channels) {
        var channel = channels[channelName];
        var ch = new XMLWriter;
        ch.startElement('channel').writeAttribute('id', channelName)
                                  .writeElement('display-name', channelName)
                                  .writeElement('display-name', `케이블:${channel.group}:${channelName}`)
                                  .startElement('icon')
                                      .writeAttribute('src', `${channel.icon}`)
                                  .endElement();
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

            if (program.episode)
                prog.startElement('episode-num').writeAttribute('system', 'onscreen').text(program.episode).endElement();

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

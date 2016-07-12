#!/usr/bin/env node

var co        = require("co");
var XMLWriter = require('xml-writer');
var pd        = require('pretty-data').pd;
var minimist  = require('minimist');
var fs        = require('fs');
var net       = require('net');
var moment    = require('moment-timezone');

var userHome = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];

var config = {
    channelFilters: [                   // 'grabber:broadcastType:channelGroup:channelName'
        // /^daum:/,
        /^skylife:(?!PPV|성인유료|공공|오디오|홈쇼핑)/,
        /^polaristv:/,
        /^naver:.*:키즈원/,
        // '폴라리스',
        // /지상파|종합편성|케이블|해외위성/,
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

    var grabbers = [];
    const grabberFolder = __dirname + '/grabbers/';
    fs.readdirSync(grabberFolder).forEach(file => {
        if (!file.endsWith('.js')) return;
        grabbers.push(require(grabberFolder + file));
    });

    var channels = {};
    for (var grabber of grabbers) {
        var grabbedChannels = yield grabber.grab(config, argv);

        for (var channelName in grabbedChannels) {
            if (channels[channelName]) {
                // merge channel epgs
            }
            else {
                channels[channelName] = grabbedChannels[channelName];
            }
        }
    }

    if (argv.c || argv.l)
        return 0;

    var doc = new XMLWriter;
    doc.startDocument('1.0', 'UTF-8');
    doc.startElement('tv').writeAttribute('source-info-name', 'EPGI')
                          .writeAttribute('generator-info-name', 'tv_grab_kr')
                          .writeAttribute('generator-info-url', 'mailto:tvgrab.kr@gmail.com');
    // add channels first
    for (var channelName in channels) {
        var channel = channels[channelName];

        var ch = new XMLWriter;
        ch.startElement('channel').writeAttribute('id', channelName)
                                  .writeElement('display-name', channelName);
        if (channel.icon)
            ch.startElement('icon').writeAttribute('src', channel.icon).endElement();
        doc.writeRaw(ch);
    }

    // add programs later
    var startDate = moment().startOf('day').add(config.offset, 'days');
    var endDate = moment(startDate).add(config.days, 'days');

    for (var channelName in channels) {
        var programs = channels[channelName].programs;

        programs.forEach(function (program, idx) {
            if (program.start.diff(startDate) < 0 || program.start.diff(endDate) >= 0) {
                // console.log('skip', program.start.format());
                return;
            }

            var start = program.start;
            var end = program.end;
            if (!end) {
                var nextProgram = programs[idx + 1];
                if (nextProgram)
                    end = nextProgram.start;
                else {
                    console.error(`** no next program: ${channelName}`);
                    end = moment(start).add(1, 'hours');
                }
            }

            var prog = new XMLWriter;
            prog.startElement('programme').writeAttribute('start', start.format("YYYYMMDDHHmmss Z").replace(':', ''))
                                          .writeAttribute('stop', end.format("YYYYMMDDHHmmss Z").replace(':', ''))
                                          .writeAttribute('channel', channelName)
                                          .startElement('title').writeAttribute('lang', 'kr').text(program.title).endElement()
                                          .writeElement('language', 'kr');
            if (program.subtitle)
                prog.startElement('sub-title').writeAttribute('lang', 'kr').text(program.subtitle).endElement();

            if (program.category)
                prog.startElement('category').writeAttribute('lang', 'kr').text(program.category).endElement();

            if (program.episode)
                prog.startElement('episode-num').writeAttribute('system', 'onscreen').text(program.episode).endElement();

            if (program.rebroadcast)
                prog.startElement('previously-shown').endElement();

            if (program.desc)
                prog.startElement('desc').writeAttribute('lang', 'kr').text(program.desc).endElement();

            if (program.rating || program.rating === 0)
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

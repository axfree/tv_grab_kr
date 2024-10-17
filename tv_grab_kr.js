#!/usr/bin/env node

var co        = require("co");
var XMLWriter = require('xml-writer');
var pd        = require('pretty-data').pd;
var argv      = require('commander');
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
    episodeNumberings: [
        'onscreen'
    ],
    days: 2,        // supply data for X days
    offset: 0       // start with data for day today plus X days
};

[ "/etc/tv_grab_kr.conf", "/etc/config/tv_grab_kr.conf", "~/.tv_grab_kr" ].forEach(function (file) {
    try {
        Object.assign(config, JSON.parse(fs.readFileSync(file.replace(/^~/, userHome))));
    }
    catch (err) {
        if (err.code != 'ENOENT') throw err;
    }
});

argv
    .version(require('./package').version, '-v, --version')
    .description('tv_grab_kr grabber by axfree')
    .option('-l, --list-channels', 'list all available channels')
    .option('-c, --list-channel-group', 'list all available channel group')
    .option('-g, --channel-filter [regex]', 'select only channels matching regular expression (can be used multiple times)', (re, res) => {
        res.push(re);
        return res;
    }, [])
    .option('-e, --episode-numbering [onscreen|xmltv_ns]', 'specify episode numbering system (can be used multiple times)', (en, ens) => {
        ens.push(en);
        return ens;
    }, [])
    // baseline options
    .option('-n, --days [X]', 'supply data for X days', (days) => config.days = days)
    .option('-o, --offset [X]', 'start with data for day today plus X days', (offset) => config.offset = offset)
    .option('-w, --output [FILENAME]', 'redirect xmltv output to the specified file', (output) => config.output = output)
    .option('-s, --sock [SOCKET]', 'redirect xmltv output to the specified XMLTV socket', (sock) => config.sock = sock)
    .option('    --description', 'print a description that identifies the grabber', () => {
        console.log('tv_grab_kr grabber by axfree');
        process.exit(0);
    })
    .option('    --capabilities', 'list the capabilities that a grabber supports', () => {
        console.log('baseline');
        process.exit(0);
    })
    .option('-d, --debug', 'print debugging information')
    .parse(process.argv);

co(function* () {
    if (argv.channelFilter.length > 0)
        config.channelFilters = argv.channelFilter;

    if (argv.episodeNumbering.length > 0)
        config.episodeNumberings = argv.episodeNumbering;

    if (config.channelFilters)
        config.channelFilters = config.channelFilters.map(re => new RegExp(re));

    var grabbers = [];
    const grabberFolder = __dirname + '/grabbers/';
    fs.readdirSync(grabberFolder).forEach(file => {
        if (!file.endsWith('.js')) return;
        grabbers.push(require(grabberFolder + file));
    });

    var channels = {};
    for (var grabber of grabbers) {
        try {
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
        catch (err) {
            console.error(err.stack);
        }
    }

    if (argv.listChannelGroup || argv.listChannels)
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
        if ('number' in channel) {
            ch.writeElement('display-name', channel.number);
            ch.writeElement('display-name', `${channel.number} ${channelName}`);
        }

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

            if (program.episode) {
                for (var en of config.episodeNumberings) {
                    switch (en) {
                        case 'onscreen':
                            prog.startElement('episode-num').writeAttribute('system', 'onscreen').text(program.episode).endElement();
                            break;
                        case 'xmltv_ns':
                            var se = program.season;
                            var ep = parseInt(program.episode);
                            if (!se) {
                                var m = program.title.match(/시즌 ?(\d+)/);
                                if (m)
                                    se = +m[1];
                            }
                            prog.startElement('episode-num').writeAttribute('system', 'xmltv_ns').text(`${se ? se - 1 : ''}.${ep - 1}.`).endElement();
                            break;
                    }
                }
            }

            if (program.rebroadcast)
                prog.startElement('previously-shown').endElement();

            if (program.desc)
                prog.startElement('desc').writeAttribute('lang', 'kr').text(program.desc).endElement();

            if (program.rating || program.rating === 0)
                prog.startElement('rating').writeAttribute('system', 'VCHIP')
                                           .writeElement('value', (program.rating == 0) ? '모든 연령 시청가' : program.rating + '세 이상 시청가').endElement();
            if (program.directors || program.actors) {
                var credits = prog.startElement('credits');
                if (program.directors)
                    program.directors.split(',').forEach(director => credits.writeElement('director', director));
                if (program.actors)
                    program.actors.split(',').forEach(actor => credits.writeElement('actor', actor));
                credits.endElement();
            }

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

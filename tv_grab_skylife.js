#!/usr/bin/env node

var co        = require("co");
var request   = require("co-request");
var XMLWriter = require('xml-writer');
var pd        = require('pretty-data').pd;
var minimist  = require('minimist');
var fs        = require('fs');
var net       = require('net');
var moment    = require('moment-timezone');

// var broadcastTypes = { 100:'지상파', 500:'종합편성', 200:'케이블', 300:'스카이라이프', 9000:'해외위성' };
var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36';
var userHome = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];

var config = {
    channelFilters: [                   // 'broadcastType:channelGroup:channelName'
        // /JTBC$/i,
        // /지상파|종합편성|케이블|스카이라이프|해외위성|라디오/,
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
            'Usage: node tv_grab_skylife.js [OPTION]\n' +
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
        console.log('tv_grab_skylife grabber by axfree');
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
        var res = yield request.post('http://www.skylife.co.kr/channel/channel_number/channelListAjax.do', {
            headers: {
                'User-Agent': ua,
            },
            form: { fd_mapp_cd: '' },
            json: true
        });

        var channels = [];
        for (var channel of res.body.channelList) {
            var channelName = channel.fd_channel_name.replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1')
                                                     .replace(/^MBC(경남)/, 'MBC $1')
                                                     .replace(/^(진주)MBC/, 'MBC $1');
            channels.push({
                name: channelName,
                group: channel.fd_genre_name || ''
            });
        }
        channels.sort((a, b) => {
            return `${a.group}:${a.name}`.localeCompare(`${b.group}:${b.name}`);
        })

        var lastGroup = '.';
        channels.forEach(c => {
            if (c.group != lastGroup) {
                if (argv.c)
                    console.log(`스카이라이프:${c.group}`);
                lastGroup = c.group;
            }
            if (argv.l)
                console.log(`스카이라이프:${c.group}:${c.name}`);
        });

        return 0;
    }

    var res = yield request.post('http://www.skylife.co.kr/channel/channel_number/channelListAjax.do', {
        headers: {
            'User-Agent': ua,
        },
        form: { fd_mapp_cd: '' },
        json: true
    });

    var channels = {};
    var channelList = res.body.channelList;
    for (var channel of channelList) {
        // console.dir(channel);
        if (!channel.fd_channel_id)
            continue;

        var channelName = channel.fd_channel_name.replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1')
                                                 .replace(/^MBC(경남)/, 'MBC $1')
                                                 .replace(/^(진주)MBC/, 'MBC $1');
        var channelFullName = `스카이라이프:${channel.fd_genre_name || ''}:${channelName}`;
        if (config.channelFilters.length > 0 && !config.channelFilters.some(re => channelFullName.match(re)))
            continue;

        if (channels[channelName]) {
            // console.log(channelName, 'skip');
            continue;
        }
        console.log(channelFullName);

        var programs = [];
        var date = moment.tz('Asia/Seoul').startOf('day');
        for (var d = 0; d < 2; d++) {
            var res = yield request.post('http://www.skylife.co.kr/channel/epg/channelScheduleList.do', {
                headers: {
                    'User-Agent': ua,
                },
                form: {
                    area: 'in',
                    indate_type: 'now',                 // 'next', 'next'
                    inairdate: date.format('YYYY-M-D'), // '2016-7-5',
                    inFd_channel_id: channel.fd_channel_id
                },
                json: true
            });

            res.body.scheduleListIn.forEach(program => {
                var start = moment(program.starttime + '+0900', 'YYYYMMDDHHmmssZ');
                if (start.diff(date) < 0)
                    return;

                programs.push(program);
            });

            date.add(1, 'days');
        }

        channels[channelName] = {
            icon: channel.fd_logo_path,
            group: channel.fd_genre_name || '',
            programs: programs
        };
    }

    var doc = new XMLWriter;
    doc.startDocument('1.0', 'UTF-8');
    doc.startElement('tv').writeAttribute('source-info-name', 'EPGI')
                          .writeAttribute('generator-info-name', 'tv_grab_skylife')
                          .writeAttribute('generator-info-url', 'mailto:tvgrab.kr@gmail.com');
    // add channels first
    for (var channelName in channels) {
        var channel = channels[channelName];
        var ch = new XMLWriter;
        ch.startElement('channel').writeAttribute('id', channelName)
                                  .writeElement('display-name', channelName)
                                  .writeElement('display-name', `스카이라이프:${channel.group}:${channelName}`)
                                  .startElement('icon')
                                      .writeAttribute('src', `http:${channel.icon}`)
                                  .endElement();
        doc.writeRaw(ch);
    }

    // add programs later
    var startDate = moment().startOf('day').add(config.offset, 'days');
    var endDate = moment(startDate).add(config.days, 'days');

    for (var channelName in channels) {
        var programs = channels[channelName].programs;

        programs.forEach(function (program, idx) {

            var start = moment(program.starttime + '+0900', 'YYYYMMDDHHmmssZ');
            var end = moment(program.endtime + '+0900', 'YYYYMMDDHHmmssZ');
            if (start.diff(startDate) < 0 || start.diff(endDate) >= 0) {
                // console.log('skip', program.tm.format());
                return;
            }

            var prog = new XMLWriter;
            prog.startElement('programme').writeAttribute('start', start.format("YYYYMMDDHHmmss Z").replace(':', ''))
                                          .writeAttribute('stop', end.format("YYYYMMDDHHmmss Z").replace(':', ''))
                                          .writeAttribute('channel', channelName)
                                          .writeElement('language', 'kr')
                                          .startElement('title').writeAttribute('lang', 'kr').text(program.program_name).endElement();
            if (program.program_subname)
                prog.startElement('sub-title').writeAttribute('lang', 'kr').text(program.program_subname).endElement();

            if (program.program_category1)
                prog.startElement('category').writeAttribute('lang', 'kr').text(program.program_category1).endElement();

            if (program.episode_id)
                prog.startElement('episode-num').writeAttribute('system', 'onscreen').text(program.episode_id + '회').endElement();

            if (program.rebroad == 'Y')
                prog.startElement('previously-shown').endElement();

            if (program.summary)
                prog.startElement('desc').writeAttribute('lang', 'kr').text(program.summary).endElement();

            prog.startElement('rating').writeAttribute('system', 'VCHIP')
                                       .writeElement('value', (program.grade == '0') ? '모든 연령 시청가' : program.grade + '세 이상 시청가');
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

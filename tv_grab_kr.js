#!/usr/bin/env node

var co        = require("co");
var request   = require("co-request");
var XMLWriter = require('xml-writer');
var pd        = require('pretty-data').pd;
                require('date-util');
var minimist  = require('minimist');
var fs        = require('fs');
var net       = require('net');

var broadcastTypes = { 100:'지상파', 500:'종합편성', 200:'케이블', 300:'스카이라이프', 9000:'해외위성' };
var genres = { I:'뉴스', A:'드라마', E:'스포츠', J:'시사/다큐', D:'오락/연예', B:'영화',
               C:'만화', H:'교육', K:'교양/정보', F:'취미/레저', G:'음악', L:'홈쇼핑' };
var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/45.0.2454.101 Safari/537.36';
var userHome = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];

var config = {
    channelGroups: [ 25, 47, 31, 38 ],
    excludedChannels: {},
    days: 2,        // supply data for X days 
    offset: 0       // start with data for day today plus X days
};

[ "/etc/tv_grab_kr.conf", "/etc/config/tv_grab_kr.conf", "~/.tv_grab_kr" ].forEach(function (file) {
    try {
        var conf = JSON.parse(fs.readFileSync(file.replace(/^~/, userHome)));
        for (var k in conf)
            config[k] = conf[k];
    }
    catch (err) {
        if (err.code != 'ENOENT') throw err;
    }
});

var argv = minimist(process.argv.slice(2), {
    alias: {
        'list-channel-group': 'l',
        'list-channels': 'c',
        'channel-group': 'g',
        'exclude-channel': 'e',
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

//console.log(process.argv);

co(function* () {
    if (argv.h) {
        console.log(
            'Usage: node tv_grab_kr.js [OPTION]\n' +
            'Options:\n' +
            '  -e, --exclude-channel=CH1,CH2,... specify the channels to be excluded by using comma separated list\n' +
            '  -g, --channel-group=GR1,GR2,...   select channel group\n' +
            '  -h, --help                        show usage information\n' +
            '  -l, --list-channel-group          list all available channel group\n' +
            '  -c, --list-channels               list all available channels\n' +
            '  -n, --days=X                      supply data for X days\n' +
            '  -o, --offset=X                    start with data for day today plus X days\n' +
            '  -w, --output=FILENAME             redirect xmltv output to the specified file\n' +
            '  -s, --sock=SOCKET                 redirect xmltv output to the specified XMLTV socket\n'
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
        config.channelGroups = argv.g.toString().split(',');
    }

    if (argv.e) {
        argv.e.toString().split(',').forEach(function (c) {
            config.excludedChannels[c] = true
        })
    }

    // collect channel groups
    var channelGroups = new Map();
    for (var broadcastType in broadcastTypes) {
        var res = yield request.post('http://tvguide.naver.com/api/channelGroup/list.nhn', {
            headers: {
                'User-Agent': ua
            },
            form: { broadcastType: broadcastType },
            json: true
        })

        var channelGroupList = res.body;
        channelGroupList.result.forEach(function (cg) {
            channelGroups.set(cg.channelGroupNo, {
                channelGroupNo: cg.channelGroupNo,
                channelGroupName: cg.channelGroupName,
                broadcastType: broadcastType
            });
        })
    }
   //console.dir(channelGroups);

    if (argv.l) {
        // list all available channel groups
        console.log([ 'ch', 'btype', 'cgroup' ].join(','));
        for (var cg of channelGroups.values()) {
            console.log([
                cg.channelGroupNo,
                broadcastTypes[cg.broadcastType],
                cg.channelGroupName
            ].join(','));
        }

        return 0;
    }

    if (argv.c) {
        // list all available channels
        var channels = [];
        for (var cg of channelGroups.values()) {
            var res = yield request("http://tvguide.naver.com/program/multiChannel.nhn", {
                headers: {
                    'User-Agent': ua
                },
                qs: { channelGroup: cg.channelGroupNo, broadcastType: cg.broadcastType, date: new Date().format("yyyymmdd") }
            });

            var m = res.body.match(/var PROGRAM_SCHEDULES=({[^]*?});/)
            if (m && m.length > 0) {
                var schedule = JSON.parse(m[1]);
                for (var channel of schedule.channelList) {
                    channels.push([
                        channel.channelId,
                        //channel.channelName,
                        channel.channelName.replace(/(.+) (SBS|KBS1|KBS2|MBC)$/, '$2 $1'),
                        broadcastTypes[cg.broadcastType],
                        cg.channelGroupName
                    ]);
                }
            }
        }

        // sort channels by channel number
        channels.sort(function (a, b) {
            return a[0] - b[0];
        });

        console.log([ 'ch', 'name', 'btype', 'cgroup' ].join(','));
        channels.forEach(function (ch) {
            console.log(ch.join(','));
        });

        return 0;
    }

    // console.log(pd.json(config));
    var date = new Date();
    date.setHours(24 * config.offset, 0, 0, 0);

    var tzOffset = (date.getTimezoneOffset() - (-9 * 60)) * 60 * 1000;
    if (tzOffset != 0)
        config.days++;

    var channels = {};

    for (var d = 0; d < config.days; d++) {
        var krDate = new Date(date.getTime() + tzOffset);
    
        for (var channelGroup of config.channelGroups) {
            var cg = channelGroups.get(parseInt(channelGroup));
            var res = yield request("http://tvguide.naver.com/program/multiChannel.nhn", {
                headers: {
                    'User-Agent': ua
                },
                qs: { channelGroup: cg.channelGroupNo, broadcastType:cg.broadcastType, date: krDate.format("yyyymmdd")}
            });
    
            var m = res.body.match(/var PROGRAM_SCHEDULES=({[^]*?});/)
            if (m && m.length > 0) {
                var schedule = JSON.parse(m[1]);
                schedule.channelList.forEach(function (channel) {
                    if (channel.channelId in config.excludedChannels || channel.channelName in config.excludedChannels) {
                        //console.log('skipping channel ' + channel.channelId)
                        return
                    }
                
                    channel.programList = channel.programList.filter(function (program) {
                        var start = new Date(program.beginDate + 'T' + program.beginTime + '+09:00');
                        return start >= date && start.getTime() < date.getTime() + 24 * 60 * 60 * 1000;
                    });
                
                    var ch = channels[channel.channelId];
                    if (ch) {
                        // append programs to the existing channel
                        ch.programList = ch.programList.concat(channel.programList);
                    }
                    else {
                        // create new channel
                        channels[channel.channelId] = channel;
                    }
                });
            }
        }
    
        date.setDate(date.getDate() + 1);
    }

    var doc = new XMLWriter;
    doc.startDocument('1.0', 'UTF-8');
    doc.startElement('tv').writeAttribute('source-info-name', 'EPGI')
                          .writeAttribute('generator-info-name', 'tv_grab_kr')
                          .writeAttribute('generator-info-url', 'mailto:tvgrab.kr@gmail.com');

    // add channels first
    for (var id in channels) {
        var channel = channels[id];
        var channelId = 'c' + ('00' + channel.channelId).slice(-3) + '.tvguide.naver.com'

        var ch = new XMLWriter;
        ch.startElement('channel').writeAttribute('id', channelId)
                                  .writeElement('display-name', channel.channelId + ' ' + channel.channelName)
                                  .writeElement('display-name', channel.channelId)
                                  .writeElement('display-name', channel.channelName)
                                  .startElement('icon').writeAttribute('src', channel.imageMulti).endElement();
        doc.writeRaw(ch);
    }

    // add programs later
    for (var id in channels) {
        var channel = channels[id];
        var channelId = 'c' + ('00' + channel.channelId).slice(-3) + '.tvguide.naver.com'

        channel.programList.forEach(function (program) {
            var prog = new XMLWriter;
            var start = new Date(program.beginDate + 'T' + program.beginTime + '+09:00');
            var end = new Date(program.beginDate + 'T' + program.endTime + '+09:00');
            if (end < start) {
                end.setDate(end.getDate() + 1);
            }

            prog.startElement('programme').writeAttribute('start', start.format("yyyymmddHHMMss o"))
                                          .writeAttribute('stop', end.format("yyyymmddHHMMss o"))
                                          .writeAttribute('channel', channelId)
                                          .startElement('title').writeAttribute('lang', 'kr').text(program.scheduleName).endElement()
                                          .startElement('sub-title').writeAttribute('lang', 'kr').text(program.subtitle).endElement()
                                          .writeElement('language', 'kr');
            if (genres[program.largeGenreId])
                prog.startElement('category').writeAttribute('lang', 'kr').text(genres[program.largeGenreId]).endElement();
            else {
                console.error('unknown genre ' + program.largeGenreId + ' for scheduleId ' + program.scheduleId);
            }

            if (program.episodeNo)
                prog.startElement('episode-num').writeAttribute('system', 'onscreen').text(program.episodeNo).endElement();
        
            if (program.rebroadcast)
                prog.startElement('previously-shown').endElement();

            prog.startElement('rating').writeAttribute('system', 'VCHIP')
                                       .writeElement('value', (program.ageRating == 0) ? '모든 연령 시청가' : program.ageRating + '세 이상 시청가');
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

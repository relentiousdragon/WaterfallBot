const e = require("../../data/emoji.js");
//
module.exports.run = async (bot, message, args, funcs) => {
    if (args[0] == undefined) {
        return message.channel.send(`${e.pixel_warning} MIN VALUE IS UNDEFINED`);
    } else if (args[1] == undefined) {
        return message.channel.send(`${e.pixel_warning} MAX VALUE IS UNDEFINED`);
    }
	let bars;
    if (args[2] != undefined) {
		bars = args[2] - 1;
    }
    if (args[0] == args[1]) {
		bars = args[2] - 1;
    }
    const progress = funcs.progressBar(args[0], args[1], bars, args[3]);
   	return message.channel.send(`${progress}`);
};

module.exports.help = {
    dev: true,
    name: "progressbar",
    aliases: ["pb"]
};

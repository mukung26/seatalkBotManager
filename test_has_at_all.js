const str = '📢 <mention-tag target="seatalk://user?id=0"/>https://docs.google.com/spreadsheets/d/...';
console.log(/<mention-tag target="seatalk:\/\/user\?id=0"\/>/.test(str));

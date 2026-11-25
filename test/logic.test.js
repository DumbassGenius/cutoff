const L = require('../logic.js'); const a = require('assert');
const at = (h,m) => { const d = new Date(2026,10,25,h,m,0); return d; };
// 22:00, cutoff 23:00 -> deadline today 23:00
a.equal(L.deadline("23:00","06:00",at(22,0)), at(23,0).getTime());
// 23:30 -> locked (now)
a.equal(L.deadline("23:00","06:00",at(23,30)), at(23,30).getTime());
// 02:00 -> locked
a.equal(L.deadline("23:00","06:00",at(2,0)), at(2,0).getTime());
// 07:00 -> tonight 23:00
a.equal(L.deadline("23:00","06:00",at(7,0)), at(23,0).getTime());
// cutoff after midnight: 01:00 / 07:00 at 23:00 -> tomorrow 01:00
const t = at(1,0); t.setDate(t.getDate()+1);
a.equal(L.deadline("01:00","07:00",at(23,0)), t.getTime());
a.equal(L.parseISODuration("PT1H2M3S"),3723); a.equal(L.parseISODuration("PT45S"),45);
a.equal(L.parseISODuration("P0D"),0); a.equal(L.parseISODuration("P1DT1H"),90000);
const dl = at(23,0).getTime();
a.ok(L.fits(30*60, 0, dl, at(22,30).getTime()));
a.ok(!L.fits(31*60, 0, dl, at(22,30).getTime()));
a.ok(L.fits(40*60, 10*60, dl, at(22,30).getTime())); // time left counts
a.equal(L.fmtDur(3723),"1:02:03"); a.equal(L.fmtLeft(95*60000),"1h 35m");
a.deepEqual(L.extractJSON('Sure: {"queries":["a","b"]} done').queries,["a","b"]);
const r = L.rankFeed([{id:1,channelId:"x",publishedAt:"2026-11-25T10:00:00Z"},{id:2,channelId:"y",publishedAt:"2026-11-24T10:00:00Z"}],{y:3});
a.equal(r[0].id,2);
console.log("all tests pass");
// ---- timer ----
{
  const now = at(20,0).getTime();
  const T = { setAt: now, end: now + 30*60000 };
  a.equal(L.timerState(null,"06:00",now),"none");
  a.equal(L.timerState(T,"06:00",now+60000),"running");
  a.equal(L.timerState(T,"06:00",now+31*60000),"done");          // stays blocking after it ends
  a.equal(L.timerState(T,"06:00",at(7,0).getTime()+86400000),"none"); // cleared after next morning reset
  a.equal(L.effectiveDeadline("23:00","06:00",T,new Date(now)), T.end);      // timer earlier than bedtime
  const late = { setAt: at(22,50).getTime(), end: at(22,50).getTime()+60*60000 };
  a.equal(L.effectiveDeadline("23:00","06:00",late,at(22,50)), at(23,0).getTime()); // bedtime earlier
  a.equal(L.effectiveDeadline("23:00","06:00",null,at(20,0)), at(23,0).getTime());
  console.log("timer tests pass");
}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOptions} from '../options.mjs';
test('default is interactive and numeric courses are unrestricted',()=>{
  assert.deepEqual(parseOptions([]),{weeks:undefined,course:undefined,list:false,help:false,status:false,nonInteractive:false,current:false,check:false,json:false});
  assert.equal(parseOptions(['--weeks','1','2','--course','999999','--list']).course,'999999');
});
test('check is read-only and JSON is only accepted for status',()=>{
  assert.equal(parseOptions(['--check','--non-interactive']).check,true);
  assert.equal(parseOptions(['--status','--json']).json,true);
  assert.throws(()=>parseOptions(['--json']),/status/);
  assert.throws(()=>parseOptions(['--check','--status']),/check/);
});
test('unattended playback requires explicit course and schedule',()=>{
  for(const args of [['--non-interactive'],['--non-interactive','--course','123'],['--non-interactive','--weeks','1'],['--weeks','1','--current'],['--course','stats']])
    assert.throws(()=>parseOptions(args));
  assert.equal(parseOptions(['--non-interactive','--course','all','--current']).current,true);
  assert.deepEqual(parseOptions(['--non-interactive','--course','123','--weeks','1','2']).weeks,[1,2]);
});
test('reject malformed or empty weeks and unknown args',()=>{
  for(const args of [['--weeks'],['--weeks','0'],['--weeks','1.5'],['--bogus'],['--course','x']])
    assert.throws(()=>parseOptions(args));
});

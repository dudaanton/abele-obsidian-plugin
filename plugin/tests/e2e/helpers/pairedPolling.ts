/** Browser-side polling used by the paired node fixtures. */
export const PAIRED_POLLING = `const until=async(fn,what,ms=60000)=>{
  const started=performance.now(),wall=Date.now();let previous=started,maxGapMs=0,checks=0;
  for(;;){
    const now=performance.now();maxGapMs=Math.max(maxGapMs,now-previous);previous=now;checks++;
    // A delayed timer may wake after the deadline with the awaited state already present.
    // Check that state before deciding that the wait failed.
    const value=fn();
    const timing={elapsedMs:performance.now()-started,wallMs:Date.now()-wall,maxGapMs,checks};
    if(value){if(maxGapMs>1000)console.log('PAIRED_WAIT_DELAY '+JSON.stringify({what,...timing}));return value}
    if(timing.elapsedMs>=ms)throw Error(what+' did not happen; polling '+JSON.stringify(timing));
    await wait(25);
  }
};`

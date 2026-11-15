async (page) => {
  await page.setViewportSize({width: 1600, height: 1000});
  await page.goto('http://127.0.0.1:8769/index.html');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({path:'需求/圖庫/desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'需求/圖庫/mobile.png'});
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await page.setViewportSize({width:2240,height:1300});
  await page.addStyleTag({content:'.art > svg{width:auto;max-width:none;min-width:0} main{max-width:none}'});
  const ids=['ui07-demo','ui01-sync','ui02-progress','ui03-override','ui04-records','ui05-plan','ui06-rules','story-student','story-maintainer'];
  const errors=[];
  for(const id of ids){
    const art=page.locator('#art-'+id+' > svg');
    const bad=await art.evaluate(svg=>{
      const box=svg.viewBox.baseVal;
      return Array.from(svg.querySelectorAll('text')).filter(t=>{
        const b=t.getBBox();return b.x<0||b.y<0||b.x+b.width>box.width||b.y+b.height>box.height;
      }).map(t=>t.textContent);
    });
    errors.push(...bad.map(text=>({id,text})));
    await art.screenshot({path:'需求/圖庫/assets/'+id+'.png'});
  }
  return {captured:ids.length,mobileOverflow,textOutsideCanvas:errors};
}

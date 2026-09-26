import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import process from 'node:process';
const base='http://127.0.0.1:5174';
const dir='qa/runtime-integration';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
const page=await context.newPage();
const result={uploadPosts:0,phases:[],errors:[]};
const save=()=>fs.writeFile(`${dir}/real-runtime-result.json`,JSON.stringify(result,null,2));
page.on('pageerror',e=>result.errors.push(e.message));
page.on('response',async response=>{
 const url=response.url();
 if(url.endsWith('/surveys/upload') && response.request().method()==='POST'){
   result.uploadPosts++; result.accepted=await response.json(); console.log('UPLOAD_ACCEPTED',JSON.stringify(result.accepted)); await save();
 }
 if(/\/jobs\//.test(url) && response.ok()){
   const job=await response.json();result.phases.push(job); console.log('JOB',job.state,job.stage);await save();
 }
});
try {
 await page.goto(base+'/');
 if(process.env.EXISTING_SURVEY_ID){
   result.accepted={survey_id:process.env.EXISTING_SURVEY_ID};
   await page.evaluate(id=>sessionStorage.setItem('astra.survey',id),result.accepted.survey_id);
   await page.goto(base+'/roles');
 }else{
   await page.getByRole('link',{name:'Launch Workspace',exact:true}).first().click();
   await expect(page).toHaveURL(/\/intake$/);
   await expect(page.getByText('Service connected',{exact:true})).toBeVisible();
   await page.getByLabel('Choose sonar survey file').setInputFiles('/Users/parvbansal/Desktop/SagarDrishti_Epitome_v2_RealSonar_FullFeature.zip');
   await expect(page.getByText('7 sonar frames',{exact:true})).toBeVisible();
   await page.screenshot({path:`${dir}/01-selected-upload.png`});
   await expect(page.getByRole('button',{name:'Process Survey'})).toBeEnabled();
   await page.getByRole('button',{name:'Process Survey'}).click();
   await expect(page).toHaveURL(/\/intake\/processing$/);
   await expect(page.locator('.processing-file')).toContainText('SagarDrishti_Epitome_v2_RealSonar_FullFeature.zip');
   await page.screenshot({path:`${dir}/02-processing.png`});
   await expect(page).toHaveURL(/\/roles$/,{timeout:600000});
 }
 const id=result.accepted.survey_id;
 const runtime=await (await page.request.get(base+'/api/v1/runtime/surveys/'+id)).json();
 await fs.writeFile(`${dir}/real-survey.json`,JSON.stringify(runtime,null,2));
 result.surveyId=runtime.survey_id;result.contactCount=runtime.contacts.length;result.observationCount=runtime.findings.length;result.frameCount=runtime.frames.length;
 expect(runtime.survey_id).toBe(id);expect(id).not.toMatch(/epitomeNavigated|epitomeNoNavigation/);
 await expect(page.getByRole('heading',{name:'Choose your station.'})).toBeVisible();
 await page.getByRole('button',{name:/Sonar Analyst Follow/}).click();
 await page.getByRole('button',{name:'Enter Workspace'}).click();
 await expect(page).toHaveURL(/\/workspace$/);
 await expect(page.getByRole('combobox',{name:'Current survey'})).toHaveValue(id);
 await page.screenshot({path:`${dir}/03-workspace.png`});
 await page.getByRole('link',{name:'View Contacts',exact:true}).first().click();
 await expect(page.locator('.result-row')).toHaveCount(runtime.contacts.length);
 await page.screenshot({path:`${dir}/04-results.png`});
 await page.locator('.result-row').first().click();
 const contactId=decodeURIComponent(page.url().split('/').pop());
 result.contactId=contactId;expect(runtime.contacts.some(c=>c.contact_id===contactId)).toBe(true);
 await expect(page.locator('.sonar-stage img').first()).toBeVisible();
 expect(await page.locator('.sonar-stage img').first().getAttribute('src')).toContain('/api/v1/runtime/surveys/'+id+'/frames/');
 await expect(page.locator('.sonar-stage img').first()).toHaveJSProperty('complete',true);
 await page.screenshot({path:`${dir}/05-contact.png`});
 await page.getByRole('link',{name:'Locate on map'}).click();
 await expect(page.locator('.contact-popup')).toBeVisible();
 result.positionedContacts=runtime.contacts.filter(c=>Number.isFinite(c.latitude)&&Number.isFinite(c.longitude)).length;
 await expect(page.locator('.contact-map-marker')).toHaveCount(result.positionedContacts);
 await expect(page.locator('.depth-profile')).toHaveCount(0);
 await expect(page.getByText('Supplied demo navigation · not field measurements',{exact:true})).toBeVisible();
 const c=runtime.contacts.find(c=>c.contact_id===contactId);
 const popup=await page.locator('.contact-popup').innerText();
 expect(popup).toContain(Math.abs(c.latitude).toFixed(4));expect(popup).toContain(Math.abs(c.longitude).toFixed(4));
 result.mapUsesSuppliedNavigation=true;result.runtimeDepthShown=false;
 await page.screenshot({path:`${dir}/06-map.png`});
 await page.getByRole('link',{name:'Inspect Contact'}).click();
 await expect(page).toHaveURL(new RegExp('/contact/'+contactId+'$'));
 await page.goto(base+'/workspace/review/'+encodeURIComponent(contactId));
 await page.getByRole('button',{name:'Needs review',exact:true}).click();
 await page.getByRole('textbox',{name:/Notes/}).fill('Internal demo integration verification. Human assessment remains required; no classification confirmed.');
 const reviewResponse=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Record decision',exact:true}).click();
 const rr=await reviewResponse;expect(rr.ok()).toBe(true);result.reviewEvent=await rr.json();
 await expect(page.getByRole('status').filter({hasText:'Decision recorded'})).toBeVisible();
 await page.screenshot({path:`${dir}/07-review.png`});
 await page.goto(base+'/workspace/memory');
 await page.locator('.memory-timeline summary').first().click();
 await expect(page.getByText('Internal demo integration verification. Human assessment remains required; no classification confirmed.',{exact:true})).toBeVisible();
 await page.screenshot({path:`${dir}/08-memory.png`});
 await page.goto(base+'/workspace/report');
 for(const [label,name] of [['Download JSON','report.json'],['Contacts CSV','contacts.csv'],['Observations CSV','observations.csv']]){
   const waiting=page.waitForEvent('download');await page.getByRole('link',{name:label,exact:true}).click();const d=await waiting;await d.saveAs(`${dir}/${name}`);expect(await d.failure()).toBeNull();
 }
 result.exports=['JSON','Contact CSV','Observation CSV'];
 await page.screenshot({path:`${dir}/09-report.png`});
 await page.goto(base+'/workspace/model-lab');
 await expect(page.getByText('YOLO11s',{exact:true})).toBeVisible();
 await page.screenshot({path:`${dir}/10-model-lab.png`});
 await page.goto(base+'/workspace/change');
 await page.screenshot({path:`${dir}/11-change.png`});
 result.fixtureSubstitution=false;result.status='PASS';
 await save();console.log('REAL_RUNTIME_PASS',JSON.stringify({id,contacts:result.contactCount,observations:result.observationCount,positioned:result.positionedContacts,errors:result.errors}));
} catch(e){ result.failure=e.message;await save();await page.screenshot({path:`${dir}/failure.png`});console.error(e);process.exitCode=1;}
finally{await browser.close();}

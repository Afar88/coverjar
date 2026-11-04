import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./helpers";

test("claim routes preserve role checks, upload validation and payout decisions",async t=>{
  const {pool}=await createTestDatabase();
  delete process.env.PAYPAL_CLIENT_ID;delete process.env.PAYPAL_CLIENT_SECRET;
  const db=await import("../src/lib/db");
  const {createSession,sessionCookie}=await import("../src/lib/auth");
  const {POST:submitClaim}=await import("../src/app/api/claims/route");
  const {POST:decideClaim}=await import("../src/app/api/claims/[id]/decide/route");
  const teenCookie=sessionCookie(createSession("teen","tobi")).split(";")[0];
  const parentCookie=sessionCookie(createSession("parent","parent")).split(";")[0];
  const submit=(cookie?:string,photo?:File)=>{
    const form=new FormData();form.set("title","Cracked phone screen");form.set("description","The screen cracked after it fell.");form.set("amount","50.00");
    if(photo)form.set("photo",photo);
    return submitClaim(new Request("http://localhost/api/claims",{method:"POST",headers:cookie?{cookie}:undefined,body:form}));
  };
  try {
    await t.test("blocks anonymous and parent users from teen claim submission",async()=>{
      assert.equal((await submit()).status,403);assert.equal((await submit(parentCookie)).status,403);
    });
    await t.test("requires a photo and rejects spoofed image content",async()=>{
      assert.equal((await submit(teenCookie)).status,400);
      const fake=new File(["<svg><script>alert(1)</script></svg>"],"damage.png",{type:"image/png"});
      const response=await submit(teenCookie,fake);assert.equal(response.status,400);
      assert.match((await response.json()).error,/valid JPEG, PNG or WebP/);
    });
    await t.test("limits repeated claim submissions per teen",async()=>{
      for(let i=0;i<3;i++)assert.equal((await submit(teenCookie)).status,400);
      const fourth=await submit(teenCookie);assert.equal(fourth.status,400);
      const fifth=await submit(teenCookie);assert.equal(fifth.status,429);
      assert.ok(Number(fifth.headers.get("retry-after"))>0);
    });
    await t.test("denies teen payout decisions and rejects over-cap parent payouts",async()=>{
      const claim=await db.insertClaim({member_id:"tobi",title:"Payout cap test",description:"Test",amount_cents:5000,photo_file:null,photo_mime:null,ai:{}});
      const body=JSON.stringify({decision:"approve",amount:"50.01"});
      const teen=await decideClaim(new Request(`http://localhost/api/claims/${claim.id}/decide`,{method:"POST",headers:{cookie:teenCookie,"content-type":"application/json"},body}),{params:Promise.resolve({id:String(claim.id)})});
      assert.equal(teen.status,403);
      const parent=await decideClaim(new Request(`http://localhost/api/claims/${claim.id}/decide`,{method:"POST",headers:{cookie:parentCookie,"content-type":"application/json"},body}),{params:Promise.resolve({id:String(claim.id)})});
      assert.equal(parent.status,400);assert.equal((await db.getClaim(claim.id))?.status,"pending_parent");
    });
    await t.test("settles an approved simulated payout once",async()=>{
      const claim=await db.insertClaim({member_id:"tobi",title:"Approved repair",description:"Test",amount_cents:2000,photo_file:null,photo_mime:null,ai:{}});
      const before=(await db.balances("tobi")).jar;
      const response=await decideClaim(new Request(`http://localhost/api/claims/${claim.id}/decide`,{method:"POST",headers:{cookie:parentCookie,"content-type":"application/json"},body:JSON.stringify({decision:"approve",amount:"10.00",payee:"parent"})}),{params:Promise.resolve({id:String(claim.id)})});
      assert.equal(response.status,200);assert.equal((await db.getClaim(claim.id))?.status,"paid");
      assert.equal(before-(await db.balances("tobi")).jar,1000);
      const repeated=await decideClaim(new Request(`http://localhost/api/claims/${claim.id}/decide`,{method:"POST",headers:{cookie:parentCookie,"content-type":"application/json"},body:JSON.stringify({decision:"deny"})}),{params:Promise.resolve({id:String(claim.id)})});
      assert.equal(repeated.status,409);assert.equal((await db.getClaim(claim.id))?.status,"paid");
    });
  } finally { await pool.end(); }
});

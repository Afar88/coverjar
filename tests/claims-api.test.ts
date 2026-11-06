import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./helpers";

test("claim routes preserve role checks, private-photo ownership and payout decisions",async t=>{
  const {pool}=await createTestDatabase();
  delete process.env.PAYPAL_CLIENT_ID;delete process.env.PAYPAL_CLIENT_SECRET;
  const db=await import("../src/lib/db");
  const storage=await import("../src/lib/storage");
  const {createSession,sessionCookie}=await import("../src/lib/auth");
  const {POST:submitClaim}=await import("../src/app/api/claims/route");
  const {POST:decideClaim}=await import("../src/app/api/claims/[id]/decide/route");
  const {POST:reconcileClaim}=await import("../src/app/api/claims/[id]/reconcile/route");
  const {GET:getState}=await import("../src/app/api/state/route");
  const {GET:getPhoto}=await import("../src/app/api/photos/[id]/route");
  const teenCookie=sessionCookie(createSession("teen","tobi")).split(";")[0];
  const otherTeenCookie=sessionCookie(createSession("teen","zara")).split(";")[0];
  const parentCookie=sessionCookie(createSession("parent","parent")).split(";")[0];
  const otherFamilyParentCookie=sessionCookie(createSession("parent","parent_other","family-other")).split(";")[0];
  const submit=(cookie?:string,photoPath?:string)=>{
    const form=new FormData();form.set("title","Cracked phone screen");form.set("description","The screen cracked after it fell.");form.set("amount","50.00");
    if(photoPath)form.set("photoPath",photoPath);
    return submitClaim(new Request("http://localhost/api/claims",{method:"POST",headers:cookie?{cookie}:undefined,body:form}));
  };
  try {
    await t.test("blocks anonymous and parent users from teen claim submission",async()=>{
      assert.equal((await submit()).status,403);assert.equal((await submit(parentCookie)).status,403);
    });
    await t.test("requires an authenticated member-scoped private Blob pathname",async()=>{
      assert.equal((await submit(teenCookie)).status,400);
      assert.equal((await submit(teenCookie,"claims/zara/123e4567-e89b-12d3-a456-426614174000.jpg")).status,400);
      assert.equal(storage.isMemberClaimPhotoPath("claims/tobi/123e4567-e89b-12d3-a456-426614174000.jpg","tobi"),true);
      assert.equal(storage.isMemberClaimPhotoPath("claims/zara/123e4567-e89b-12d3-a456-426614174000.jpg","tobi"),false);
      assert.equal(storage.detectClaimPhoto(Buffer.from("<svg><script>alert(1)</script></svg>")),null);
    });
    await t.test("limits repeated claim submissions per teen",async()=>{
      for(let i=0;i<5;i++)assert.equal((await submit(otherTeenCookie)).status,400);
      const blocked=await submit(otherTeenCookie);
      assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get("retry-after"))>0);
    });
    await t.test("denies teen payout decisions and rejects over-cap parent payouts",async()=>{
      const claim=await db.insertClaim({member_id:"tobi",title:"Payout cap test",description:"Test",amount_cents:5000,photo_file:null,photo_mime:null,ai:{}});
      const body=JSON.stringify({decision:"approve",amount:"50.01"});
      const teen=await decideClaim(new Request(`http://localhost/api/claims/${claim.id}/decide`,{method:"POST",headers:{cookie:teenCookie,"content-type":"application/json"},body}),{params:Promise.resolve({id:String(claim.id)})});
      assert.equal(teen.status,403);
      const parent=await decideClaim(new Request(`http://localhost/api/claims/${claim.id}/decide`,{method:"POST",headers:{cookie:parentCookie,"content-type":"application/json"},body}),{params:Promise.resolve({id:String(claim.id)})});
      assert.equal(parent.status,400);assert.equal((await db.getClaim(claim.id))?.status,"pending_parent");
    });
    await t.test("a different family cannot read or decide another family's claim",async()=>{
      const claim=await db.insertClaim({member_id:"tobi",family_id:"legacy-family",title:"Private family claim",description:"Must remain private",amount_cents:2000,photo_file:null,photo_mime:null,ai:{}});
      const request=new Request(`http://localhost/api/claims/${claim.id}/decide`,{method:"POST",headers:{cookie:otherFamilyParentCookie,"content-type":"application/json"},body:JSON.stringify({decision:"deny"})});
      const response=await decideClaim(request,{params:Promise.resolve({id:String(claim.id)})});
      assert.equal(response.status,404);
      assert.equal((await db.getClaim(claim.id,"legacy-family"))?.status,"pending_parent");
      await db.queryRows("UPDATE claims SET status='payout_pending',payout_cents=500,payee_email='repair@example.test' WHERE id=$1",[claim.id]);
      const reconcile=await reconcileClaim(new Request(`http://localhost/api/claims/${claim.id}/reconcile`,{method:"POST",headers:{cookie:otherFamilyParentCookie}}),{params:Promise.resolve({id:String(claim.id)})});
      assert.equal(reconcile.status,404);
    });
    await t.test("family dashboards and photo routes do not expose another family's data",async()=>{
      const family=await db.createFamilyAccount("Other Household","x".repeat(64));
      await db.addTeenToFamily(family.id,"Other teen","y".repeat(64));
      const privateClaim=await db.insertClaim({member_id:"tobi",family_id:"legacy-family",title:"Private photo",description:"Private",amount_cents:2000,photo_file:"claims/tobi/123e4567-e89b-12d3-a456-426614174000.jpg",photo_mime:"image/jpeg",ai:{}});
      const cookie=sessionCookie(createSession("parent",`parent_${family.id}`,family.id)).split(";")[0];
      const stateResponse=await getState(new Request("http://localhost/api/state",{headers:{cookie}}));
      assert.equal(stateResponse.status,200);
      const state=await stateResponse.json();
      assert.ok(state.members.some((m:{name:string})=>m.name==="Other teen"));
      assert.ok(state.members.every((m:{id:string})=>m.id!=="tobi"&&m.id!=="zara"));
      assert.ok(state.ledger.every((entry:{member_id:string})=>entry.member_id!=="tobi"&&entry.member_id!=="zara"));
      assert.ok(state.claims.every((claim:{id:number})=>claim.id!==privateClaim.id));
      const photoResponse=await getPhoto(new Request(`http://localhost/api/photos/${privateClaim.id}`,{headers:{cookie}}),{params:Promise.resolve({id:String(privateClaim.id)})});
      assert.equal(photoResponse.status,404);
    });
    await t.test("settles an approved simulated payout once",async()=>{
      const claim=await db.insertClaim({member_id:"tobi",title:"Approved repair",description:"Test",amount_cents:2000,photo_file:null,photo_mime:null,ai:{}});
      await db.queryRows("UPDATE members SET payout_email=$1 WHERE id=$2 AND family_id=$3",["parent@gmail.com","parent","legacy-family"]);
      const before=(await db.balances("tobi")).jar;
      const response=await decideClaim(new Request(`http://localhost/api/claims/${claim.id}/decide`,{method:"POST",headers:{cookie:parentCookie,"content-type":"application/json"},body:JSON.stringify({decision:"approve",amount:"10.00",payee:"parent"})}),{params:Promise.resolve({id:String(claim.id)})});
      assert.equal(response.status,200);assert.equal((await db.getClaim(claim.id))?.status,"paid");
      assert.equal(before-(await db.balances("tobi")).jar,1000);
      const repeated=await decideClaim(new Request(`http://localhost/api/claims/${claim.id}/decide`,{method:"POST",headers:{cookie:parentCookie,"content-type":"application/json"},body:JSON.stringify({decision:"deny"})}),{params:Promise.resolve({id:String(claim.id)})});
      assert.equal(repeated.status,409);assert.equal((await db.getClaim(claim.id))?.status,"paid");
    });
  } finally { await pool.end(); }
});

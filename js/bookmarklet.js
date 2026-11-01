// The phone bookmarklet's source. Tapped on a Walmart or Sam's Club product page, it reads the page's product data (or fetches it,
// if Walmart changed pages without a reload) and opens the app with it: #wm=j.<base64url JSON>. Kept short and
// self-contained because it's saved as a bookmark. The app shows it in Goals → Walmart on your phone.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SelfCheckBookmarklet = factory();
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function () {
  const SOURCE = `(async()=>{try{
const R=s=>JSON.parse(s).props.pageProps.initialData.data;
const id=(location.pathname.match(/\\/ip\\/(?:[^/]+\\/)?(\\d+)/)||[])[1];
if(!/(walmart|samsclub)\\.com$/.test(location.hostname)||!id){alert('Open a Walmart or Sam\\'s Club product page first, then tap this bookmark.');return}
const t=document.getElementById('__NEXT_DATA__');let d=t&&R(t.textContent);
if(!d||!d.product||String(d.product.usItemId||id)!==id){const h=await(await fetch(location.href)).text();d=R(h.match(/<script id="__NEXT_DATA__"[^>]*>([\\s\\S]*?)<\\/script>/)[1])}
const p=d.product||{},i=d.idml||{},n=i.nutritionFacts||{};
const q=p.priceInfo||{},o={app:'should-i-buy-it',v:1,kind:'walmart',data:{store:/samsclub/.test(location.hostname)?'sams':'walmart',product:{usItemId:p.usItemId,name:p.name,upc:p.upc,brand:p.brand,priceInfo:{currentPrice:{price:(q.currentPrice||{}).price},unitPrice:{price:(q.unitPrice||{}).price,priceString:(q.unitPrice||{}).priceString}},category:{path:((p.category||{}).path||[]).map(c=>({name:c.name}))}},idml:{ingredients:i.ingredients,nutritionFacts:{calorieInfo:n.calorieInfo,keyNutrients:n.keyNutrients,servingInfo:n.servingInfo}}}};
location.href='SITE#wm=j.'+btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')
}catch(e){alert('Couldn\\'t read this page. Reload it and tap the bookmark again.')}})()`;
  // The javascript: URL to save as a bookmark, pointing at the given app address.
  const url = (site = "https://quochhdo.github.io/should-i-buy-it/") => "javascript:" + encodeURIComponent(SOURCE.replace(/\n/g, "").replace("SITE", site));
  return { SOURCE, url };
});

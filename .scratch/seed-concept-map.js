(async () => {
 const db = await new Promise((resolve,reject) => { const r=indexedDB.open('read-buddy'); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
 const read = name => new Promise((resolve,reject) => {const q=db.transaction(name).objectStore(name).getAll(); q.onsuccess=()=>resolve(q.result); q.onerror=()=>reject(q.error);});
 const books=await read('books'); const nodes=await read('book_nodes');
 const book=books.find(b=>b.title==='concept-map-check');
 const node=nodes.find(n=>n.bookHash===book.hash && n.nodeIndex===0);
 const full=new TextDecoder().decode(book.data);
 const text=full.slice(node.startOffset,node.endOffset);
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
 const definitions=[['root','知识结构',null,'概念地图通过层级和关系帮助理解知识。'],['a','层级关系','root','层级关系描述整体和部分。'],['b','因果关系','root','因果关系描述一个条件如何影响另一个结果。'],['c','主动回忆','b','主动回忆可以加强记忆，而间隔复习能够帮助知识保持。'],['d','原文证据','root','原文证据帮助读者检验解释是否准确。']];
 const concepts=definitions.map(([id,label,parentId,quote])=>({id,label,parentId,quote,description:quote,charOffset:text.indexOf(quote)}));
 const map={id:book.hash+':0',bookHash:book.hash,nodeIndex:0,title:node.title,fingerprint,model:'浏览器测试数据',updatedAt:Date.now(),concepts,relations:[{source:'d',target:'a',label:'验证'},{source:'c',target:'a',label:'巩固'}]};
 await new Promise((resolve,reject)=>{const tx=db.transaction('concept_maps','readwrite');tx.objectStore('concept_maps').put(map);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
 db.close(); return {title:node.title,concepts:concepts.length,textLength:text.length};
})()

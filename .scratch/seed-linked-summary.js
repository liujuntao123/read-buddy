(async () => {
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('read-buddy');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 const read=name=>new Promise(resolve=>{const q=db.transaction(name).objectStore(name).getAll();q.onsuccess=()=>resolve(q.result)});
 const books=await read('books');const book=books.find(b=>b.title==='concept-map-check');
 const summaryContent='## 核心要义\n- **建立知识结构**：概念地图通过层级和关系帮助理解知识。\n- **用证据检验理解**：原文证据帮助读者检验解释是否准确。\n\n## 关键内容脉络\n1. **从整体到部分**：层级关系把中心主题拆解为更小的概念，帮助学习者逐步建立知识结构。\n2. **理解概念间的因果**：主动回忆可以加强记忆，而间隔复习能够帮助知识保持。\n3. **回到原文验证**：通过原文证据检查结论的背景和限制，再将知识应用到新的问题。\n\n## 核心概念与关键术语\n- **层级关系**：描述整体和部分之间的组织方式。\n- **主动回忆**：主动从记忆中提取知识，帮助加深理解和保持记忆。\n- **间隔复习**：将学习分散在不同时间，巩固知识。\n- **原文证据**：支撑判断的原始表述，用于检验解释是否准确。';
 await new Promise((resolve,reject)=>{const tx=db.transaction('node_summaries','readwrite');tx.objectStore('node_summaries').put({id:book.hash+':0',bookHash:book.hash,nodeIndex:0,nodeTitle:'概念如何连接',summaryContent,modelUsed:'浏览器测试',createdAt:Date.now(),updatedAt:Date.now()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();return 'Seeded summary';
})()

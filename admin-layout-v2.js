/* Nuvora Admin collapsible information architecture */
(function(){
 "use strict";
 const $=(selector,root=document)=>root.querySelector(selector);
 const $$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
 function createAccordion(host,labelNode,opts){
  if(!host||host.dataset.nvAccordion==="true"||!labelNode)return null;
  const details=document.createElement("details");
  details.className=[...host.classList,"nv-accordion"].join(" ");
  details.open=!!opts.open;
  details.dataset.nvAccordion="true";
  const summary=document.createElement("summary");
  summary.className=opts.summaryClass||"";
  summary.setAttribute("aria-label",labelNode.textContent.trim());
  const labelText=labelNode.textContent.trim();
  summary.textContent=labelText;
  const content=document.createElement("div");
  content.className=opts.contentClass||"nv-accordion-content";
  const siblings=[...host.childNodes].filter(node=>node!==labelNode);
  siblings.forEach(node=>content.appendChild(node));
  details.append(summary,content);
  host.replaceChildren(details);
  return details;
 }
 function upgradeAdminNavigation(){
  const nav=$(".app .side .nav");
  if(!nav)return;
  $$(".nav-group",nav).forEach((group,index)=>{
   const label=$(":scope > .nav-group-label",group);
   if(!label)return;
   const text=label.textContent.trim().toLowerCase();
   const open=/workspace|your storefronts/.test(text);
   createAccordion(group,label,{open,summaryClass:"nv-admin-nav-summary",contentClass:"nv-admin-nav-items"});
  });
 }
 function upgradeStudioWorkspace(){
  const nav=$("#skinSiteBuilder .studio-workspace-nav");
  if(!nav)return;
  $$(".studio-workspace-group",nav).forEach((group,index)=>{
   const label=$(":scope > .studio-workspace-label",group);
   if(!label)return;
   const open=label.textContent.trim().toLowerCase()==="storefront";
   createAccordion(group,label,{open,summaryClass:"nv-workspace-summary",contentClass:"nv-workspace-items"});
  });
 }
 function upgradeOutlineGroups(){
  const root=$("#skinBuilderSections");
  if(!root)return;
  $$(".studio-outline-group",root).forEach(group=>{
   if(group.dataset.nvAccordion==="true")return;
   const heading=$(":scope > .studio-outline-group-heading",group);
   if(!heading)return;
   const details=document.createElement("details");
   details.className=[...group.classList,"nv-outline-accordion"].join(" ");
   details.open=group.classList.contains("studio-outline-template-group");
   details.dataset.nvAccordion="true";
   const summary=document.createElement("summary");
   summary.className="nv-outline-summary";
   while(heading.firstChild)summary.appendChild(heading.firstChild);
   const content=document.createElement("div");
   content.className="nv-outline-content";
   [...group.childNodes].filter(node=>node!==heading).forEach(node=>content.appendChild(node));
   details.append(summary,content);
   group.replaceWith(details);
  });
 }
 function upgradeSettingsGroups(){
  const root=$("#skinSiteBuilder .studio-site-settings");
  if(!root)return;
  $$(".skin-builder-group",root).forEach((group,index)=>{
   if(group.dataset.nvAccordion==="true")return;
   const heading=$(":scope > .skin-builder-group-heading",group);
   if(!heading)return;
   const details=document.createElement("details");
   details.className=[...group.classList,"nv-settings-accordion"].join(" ");
   details.open=index===0;
   details.dataset.nvAccordion="true";
   const summary=document.createElement("summary");
   summary.className="skin-builder-group-heading nv-settings-summary";
   while(heading.firstChild)summary.appendChild(heading.firstChild);
   [...group.childNodes].filter(node=>node!==heading).forEach(node=>details.appendChild(node));
   details.prepend(summary);
   group.replaceWith(details);
  });
 }
 function openRelevantGroups(target){
  const workspace=target.closest(".studio-workspace-group");
  if(workspace?.matches("details"))workspace.open=true;
  const navGroup=target.closest(".nav-group");
  if(navGroup?.matches("details"))navGroup.open=true;
 }
 function bindNavigation(){
  document.addEventListener("click",event=>{
   const target=event.target instanceof Element?event.target.closest(".studio-workspace-item,.nav-group button"):null;
   if(target)openRelevantGroups(target);
  },true);
 }
 function bindOutlineSearch(){
  const root=$("#skinBuilderSections");
  if(!root||root.dataset.nvSearchBound==="true")return;
  root.dataset.nvSearchBound="true";
  const observer=new MutationObserver(()=>{
   upgradeOutlineGroups();
   const search=$("#skinStudioSectionSearch",root);
   const needle=String(search?.value||"").trim();
   if(needle)$$(".nv-outline-accordion",root).forEach(group=>{if(!group.hidden)group.open=true;});
  });
  observer.observe(root,{childList:true,subtree:true});
  upgradeOutlineGroups();
 }
 function bindSettingGroupUpdates(){
  const root=$("#skinSiteBuilder .studio-site-settings");
  if(!root||root.dataset.nvObserveBound==="true")return;
  root.dataset.nvObserveBound="true";
  const observer=new MutationObserver(()=>upgradeSettingsGroups());
  observer.observe(root,{childList:true,subtree:true});
  upgradeSettingsGroups();
 }
 function wrapSettingsNavigation(){
  const original=window.openSkinStudioGlobalSettings;
  if(typeof original==="function"&&original.__nvWrapped!==true){
   const wrapped=function(area){
    const result=original.apply(this,arguments);
    const match=area==="footer"?"Footer & site information":"Header & navigation";
    const groups=$$(".studio-right-panel .skin-builder-group");
    const target=groups.find(group=>String($(".skin-builder-group-heading",group)?.textContent||"").includes(match));
    if(target){target.open=true;target.scrollIntoView({behavior:"smooth",block:"start"});}
    return result;
   };
   wrapped.__nvWrapped=true;
   window.openSkinStudioGlobalSettings=wrapped;
  }
 }
 function initialise(){
  upgradeAdminNavigation();
  upgradeStudioWorkspace();
  upgradeSettingsGroups();
  upgradeOutlineGroups();
  bindOutlineSearch();
  bindSettingGroupUpdates();
  bindNavigation();
  wrapSettingsNavigation();
  const root=$("#skinBuilderSections");
  if(root&&!root.dataset.nvSearchBound)bindOutlineSearch();
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initialise,{once:true});
 else initialise();
})();
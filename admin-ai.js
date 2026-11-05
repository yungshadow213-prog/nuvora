(() => {
  "use strict";
  if (window.__nuvoraClaudeMounted) return;
  window.__nuvoraClaudeMounted = true;

  const history = [];
  let busy = false;
  let panel, messages, input, sendButton, status;
  const $ = (selector, root = document) => root.querySelector(selector);

  function request(path, options) {
    if (typeof window.NuvoraAIRequest !== "function") {
      throw new Error("The secure Nuvora admin session is not ready. Sign in again and reopen the assistant.");
    }
    return window.NuvoraAIRequest(path, options || {});
  }

  function contextSnapshot() {
    const page = $(".view.active");
    const pageTitle = $(".top h1")?.textContent?.trim()
      || $("#storeTitle")?.textContent?.trim()
      || $(".studio-page-line")?.textContent?.trim()
      || document.title;
    const activeTab = $(".studio-workspace-item.active, .tabs button.active, .nav button.active");
    const selectedSection = $(".studio-section-outline.is-selected, .studio-section-outline.active, .skin-builder-sections button.active");
    const data = {
      application: "Nuvora Admin",
      page: page?.id || pageTitle,
      pageTitle,
      workspace: activeTab?.innerText?.replace(/\s+/g, " ").trim() || "",
      selectedSection: selectedSection?.innerText?.replace(/\s+/g, " ").trim() || "",
      storefront: $("#storeTitle")?.textContent?.trim() || (document.body.classList.contains("skin-studio-fullpage") ? "Nuvora Skin Care" : "Nuvora"),
      editorMode: document.body.classList.contains("skin-studio-fullpage") ? "Skin Studio full-page theme editor" : "Nuvora Admin",
      visibleHeadings: Array.from((page || document).querySelectorAll("h1,h2,h3")).slice(0, 12).map(x => x.textContent.trim()).filter(Boolean)
    };
    const productFields = [
      ["productName", "pfName"], ["brand", "pfBrand"], ["productType", "pfType"],
      ["category", "pfCategory"], ["description", "pfDescription"],
      ["ingredients", "pfIngredients"], ["skinTypes", "pfSkinTypes"],
      ["skinConcerns", "pfSkinConcerns"], ["usage", "pfUsage"], ["warnings", "pfWarnings"],
      ["destinationUrl", "pfDestination"]
    ];
    const product = {};
    for (const [key, id] of productFields) {
      const element = document.getElementById(id);
      if (element && String(element.value || "").trim()) product[key] = String(element.value).trim().slice(0, 900);
    }
    if (Object.keys(product).length) data.openProductForm = product;
    return data;
  }

  function appendMessage(role, text, pending = false) {
    const node = document.createElement("div");
    node.className = "nuvora-ai-message " + role + (pending ? " pending" : "");
    node.textContent = text;
    messages.appendChild(node);
    messages.scrollTop = messages.scrollHeight;
    return node;
  }

  function setStatus(message, state = "idle") {
    status.textContent = message;
    status.dataset.state = state;
  }

  function addSuggestion(label, prompt) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      input.value = prompt;
      input.focus();
      send();
    });
    return button;
  }

  function mount() {
    const host = $(".studio-toolbar-actions") || $(".top-actions") || $(".topbar");
    if (!host) return;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "nuvora-ai-trigger";
    trigger.innerHTML = '<span class="nuvora-ai-spark" aria-hidden="true">✦</span><span>Ask Claude</span>';
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", "nuvoraClaudePanel");
    host.appendChild(trigger);

    panel = document.createElement("section");
    panel.className = "nuvora-ai-panel";
    panel.id = "nuvoraClaudePanel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Nuvora AI assistant");
    panel.innerHTML = [
      '<header class="nuvora-ai-head">',
      '<div class="nuvora-ai-brand"><span class="nuvora-ai-mark" aria-hidden="true">✦</span><span><b>Nuvora AI</b><small>Powered by Claude · Admin assistant</small></span></div>',
      '<div class="nuvora-ai-head-actions"><button type="button" class="nuvora-ai-icon-button" data-clear title="Clear conversation" aria-label="Clear conversation">↺</button><button type="button" class="nuvora-ai-icon-button" data-close title="Close assistant" aria-label="Close assistant">×</button></div>',
      '</header>',
      '<div class="nuvora-ai-status" role="status" aria-live="polite" data-state="idle">Checking Claude connection…</div>',
      '<div class="nuvora-ai-messages" aria-live="polite">',
      '<div class="nuvora-ai-welcome">I can help you work through Nuvora\\'s admin, storefront structure, product organization and editor workflows. I use the workspace context visible on this page, and I will distinguish recommendations from changes that have actually been saved.</div>',
      '<div class="nuvora-ai-suggestions"></div>',
      '</div>',
      '<form class="nuvora-ai-compose">',
      '<textarea aria-label="Message Claude" placeholder="Ask about this page, product, storefront or workflow…"></textarea>',
      '<div class="nuvora-ai-compose-row"><small>Claude can advise and prepare content.<br>Publishing remains under your control.</small><button type="submit" class="nuvora-ai-send">Send to Claude ↗</button></div>',
      '</form>',
      '<div class="nuvora-ai-disclaimer">AI responses can be wrong. Verify product claims and important settings before saving.</div>'
    ].join("");
    document.body.appendChild(panel);

    messages = $(".nuvora-ai-messages", panel);
    input = $("textarea", panel);
    sendButton = $(".nuvora-ai-send", panel);
    status = $(".nuvora-ai-status", panel);
    const suggestionWrap = $(".nuvora-ai-suggestions", panel);
    suggestionWrap.append(
      addSuggestion("Improve this layout", "Review the current Nuvora workspace and suggest a clear, prioritized improvement to its layout and information hierarchy."),
      addSuggestion("Help organize my store", "Recommend a clearer storefront navigation and product categorization structure using only the context available. Identify any assumptions."),
      addSuggestion("Review this editor", "Review this editor workflow. Point out confusing controls, duplicated settings, and ways to make the editing flow easier without removing features.")
    );

    trigger.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      trigger.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) { input.focus(); checkConnection(); }
    });
    $("[data-close]", panel).addEventListener("click", () => {
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    });
    $("[data-clear]", panel).addEventListener("click", () => {
      history.length = 0;
      messages.querySelectorAll(".nuvora-ai-message").forEach(node => node.remove());
      appendMessage("assistant", "Conversation cleared. What would you like to work on?");
    });
    $(".nuvora-ai-compose", panel).addEventListener("submit", event => {
      event.preventDefault();
      send();
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });
    checkConnection();
  }

  async function checkConnection() {
    try {
      const health = await request("/api/health", { method: "GET" });
      if (health?.configured?.claude) setStatus("Claude is connected. Workspace context is included with your question.", "ready");
      else setStatus("Claude is not connected yet. Add ANTHROPIC_API_KEY as a Cloudflare Worker secret, then reload.", "error");
    } catch (error) {
      setStatus(error.message || "Could not check the Claude connection. Sign in again if your session expired.", "error");
    }
  }

  async function send() {
    const message = String(input.value || "").trim();
    if (!message || busy) return;
    busy = true;
    input.value = "";
    sendButton.disabled = true;
    appendMessage("user", message);
    history.push({ role: "user", content: message });
    const pending = appendMessage("assistant", "Claude is reviewing the current workspace…", true);
    setStatus("Working on your request…", "idle");
    try {
      const response = await request("/api/admin/ai/claude-chat", {
        method: "POST",
        body: {
          message,
          history: history.slice(0, -1).slice(-8),
          context: contextSnapshot()
        }
      });
      if (!response?.ok || !response?.text) throw new Error("Claude did not return a response.");
      pending.classList.remove("pending");
      pending.textContent = response.text;
      history.push({ role: "assistant", content: response.text });
      if (history.length > 16) history.splice(0, history.length - 16);
      setStatus("Claude · " + (response.model || "connected"), "ready");
    } catch (error) {
      pending.remove();
      appendMessage("assistant", "I couldn't complete that request: " + (error.message || "Unknown error."));
      setStatus(error.message || "Claude request failed.", "error");
    } finally {
      busy = false;
      sendButton.disabled = false;
      input.focus();
      messages.scrollTop = messages.scrollHeight;
    }
  }

  window.generateSkinProductWithClaude = async function () {
    const get = id => document.getElementById(id);
    const url = String(get("pfDestination")?.value || "").trim();
    const statusNode = get("skinClaudeStatus");
    const button = get("skinClaudeFillBtn");
    if (!url) {
      if (statusNode) statusNode.textContent = "Add the exact Amazon product URL before asking Claude to prepare the guide.";
      return;
    }
    const replace = !!get("skinClaudeReplaceExisting")?.checked;
    const original = button?.textContent;
    if (button) { button.disabled = true; button.textContent = "Researching with Claude…"; }
    if (statusNode) statusNode.textContent = "Reading available retailer facts and preparing a source-conscious product guide. Nothing will be saved or published automatically.";
    try {
      const result = await request("/api/admin/ai/claude-skin-product", { method: "POST", body: { url } });
      const product = result?.product;
      if (!result?.ok || !product) throw new Error("Claude did not return a usable product guide.");
      const fill = (id, value) => {
        const element = get(id);
        if (!element || value == null) return false;
        const next = Array.isArray(value) ? value.join("\\n") : String(value);
        if (!next.trim()) return false;
        if (element instanceof HTMLSelectElement && element.multiple) {
          const values = Array.isArray(value) ? value.map(String) : [];
          const available = new Set(Array.from(element.options).map(option => String(option.value)));
          const selected = values.filter(item => available.has(item));
          if (!selected.length || (!replace && element.selectedOptions.length)) return false;
          Array.from(element.options).forEach(option => { option.selected = selected.includes(String(option.value)); });
        } else {
          if (!replace && String(element.value || "").trim()) return false;
          element.value = next;
        }
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      };
      const entries = [
        ["pfName", product.name], ["pfBrand", product.brand], ["pfDescription", product.overview],
        ["pfFeatures", product.benefits], ["pfBenefits", product.benefits],
        ["pfSkinTypes", product.skin_types], ["pfSkinConcerns", product.skin_concerns],
        ["pfIngredients", product.ingredients], ["pfUsage", product.usage_instructions],
        ["pfSkinAvoid", product.product_warnings], ["pfWarnings", product.product_warnings],
        ["pfProductSize", product.size], ["pfRecommendedProducts", product.recommended_product_ids],
        ["pfRecommendationReason", product.recommendation_reason], ["pfAsin", product.asin],
        ["pfRating", product.rating], ["pfAvailability", product.availability]
      ];
      let filled = 0;
      for (const [id, value] of entries) if (fill(id, value)) filled++;
      const destination = get("pfDestination");
      if (destination && !destination.value.trim()) destination.value = url;
      const images = get("pfImages");
      if (images && (!String(images.value || "").trim() || replace) && Array.isArray(product.images) && product.images.length) {
        images.value = product.images.join("\\n");
        images.dispatchEvent(new Event("input", { bubbles: true }));
        filled++;
        if (typeof window.renderProductImages === "function") window.renderProductImages();
      }
      if (typeof window.updateRetailerRatingPreview === "function") window.updateRetailerRatingPreview();
      const notes = Array.isArray(product.confidence_notes) ? product.confidence_notes.join(" · ") : "";
      if (statusNode) statusNode.textContent = "Claude prepared " + filled + " fields. Review every field and source note before saving. " + (notes ? "Notes: " + notes : "No product was saved or published.");
      if (typeof window.productSaveMessage === "function") window.productSaveMessage("Claude prepared the product guide. Review the fields and click Save Draft when ready.", "success");
    } catch (error) {
      const message = error.message || "Claude could not prepare this product.";
      if (statusNode) statusNode.textContent = message;
      if (typeof window.productSaveMessage === "function") window.productSaveMessage(message, "error");
    } finally {
      if (button) { button.disabled = false; button.textContent = original || "Prepare guide with Claude"; }
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
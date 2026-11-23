# Nuvora Women’s Fashion

Nuvora is now a women’s fashion discovery and affiliate storefront. It helps visitors discover clothing, shoes, handbags, jewellery and accessories through curated categories, outfit inspiration, product guides and comparisons.

The storefront is served at **`/fashion`**. The previous **`/beauty`** route redirects to the new fashion route. The fashion editor is available at **`/admin/womens-fashion`** inside the existing Nuvora Admin.

## Current catalogue reset

The live product catalogue is currently empty and ready for a fresh fashion start. The fashion category taxonomy and existing fashion collections are retained. Admin users, store settings and analytics are not part of the inventory reset.

## Fashion categories

- **Clothing:** Dresses, Tops & Blouses, Shirts, Trousers & Jeans, Skirts, Co-ords & Matching Sets, Jumpsuits & Playsuits, Knitwear, Jackets & Coats.
- **Shoes:** Heels, Flats, Sneakers, Boots, Sandals.
- **Bags:** Handbags, Tote & Shopper Bags, Crossbody & Shoulder Bags, Clutches & Evening Bags.
- **Accessories:** Jewellery, Watches, Sunglasses, Belts & Scarves, Hair Accessories, Fashion Accessories.
- **Other fashion:** Activewear, Loungewear & Sleepwear, Occasionwear.

## Product editor

The Women’s Fashion Studio is the fashion-specific product and storefront workspace within Nuvora Admin. It retains the existing visual page builder, preview, page sections, product placement, image galleries, media uploads, drafts and publish workflow.

Product records are organised around fashion details:
- Product type and fashion category
- Brand and retailer
- Clothing sizes, colour options and fit
- Fabric and material composition
- Fit and sizing notes
- Style tags and aesthetics
- Occasions and outfit suggestions
- Garment care details
- Images, gallery, retailer destination and affiliate disclosure

## Retailer sourcing

Product entry is retailer-neutral. Add a product manually or paste a supported retailer product URL for listing extraction and AI-assisted fashion categorisation where the retailer exposes readable product information. Amazon remains available as one retailer; the Amazon bulk queue is an optional Amazon-specific workflow, not a restriction on the whole catalogue.

Every imported item remains a draft until reviewed. Confirm product identity, images, retailer, material composition, size chart, garment measurements, fit, colour options, care instructions and the exact affiliate destination against the current retailer listing. Do not invent details that the source does not provide.

## Storefront experiences

The public storefront supports:
- Fashion discovery homepage and shop categories
- Product guides and side-by-side product comparison
- Style and occasion product finder
- Style preferences saved locally in the visitor’s browser
- Outfit builder and saved outfit edits
- Materials guide
- Product alternatives and recently viewed products
- Fashion shopping assistant using published catalogue information
- Editorial inspiration and wardrobe guides

These experiences are browsing aids. They do not guarantee a garment’s fit, sizing, quality or suitability. Shoppers should check the retailer’s current listing and measurements before purchasing.

## Data and deployment

The main project uses the existing Supabase-backed Nuvora Admin and Cloudflare Worker. The worker preserves legacy internal API/database identifiers for compatibility while the user-facing product and editor experience is women’s fashion.

Run the standard repository checks and confirm the Cloudflare deployment and live smoke checks before treating a GitHub change as live. A successful commit alone does not confirm a deployment.

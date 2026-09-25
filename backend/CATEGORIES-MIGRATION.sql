-- Nuvora broad storefront category system
alter table public.categories add column if not exists parent_id uuid references public.categories(id) on delete set null;
create index if not exists categories_parent_id_idx on public.categories(parent_id);

with roots(name,slug,description) as (
  values
  ('Fashion','fashion','Clothing, footwear, bags and accessories.'),
  ('Baby & Kids','baby-kids','Baby, kids and family essentials.'),
  ('Home & Living','home-living','Home, kitchen, decor and organization.'),
  ('Electronics','electronics','Tech, gadgets, audio and accessories.'),
  ('Beauty & Personal Care','beauty-personal-care','Beauty, skincare, hair and personal care.'),
  ('Sports & Fitness','sports-fitness','Fitness, sports and outdoor essentials.'),
  ('Automotive','automotive','Car accessories, gadgets and essentials.'),
  ('Pets','pets','Products for pets and pet owners.'),
  ('Gifts & Lifestyle','gifts-lifestyle','Giftable, seasonal and everyday lifestyle finds.')
)
insert into public.categories(name,slug,description)
select name,slug,description from roots
on conflict(slug) do update set description=excluded.description;

with root_map as (
  select id,slug from public.categories where parent_id is null and slug in ('fashion','baby-kids','home-living','electronics','beauty-personal-care','sports-fitness','automotive','pets','gifts-lifestyle')
), subs(root_slug,name,slug,description) as (
  values
  ('fashion','Women','fashion-women','Women''s clothing and fashion.'),
  ('fashion','Men','fashion-men','Men''s clothing and fashion.'),
  ('fashion','Kids','fashion-kids','Children''s clothing and fashion.'),
  ('fashion','Shoes','fashion-shoes','Shoes and footwear.'),
  ('fashion','Bags','fashion-bags','Bags and everyday carry.'),
  ('fashion','Accessories','fashion-accessories','Fashion accessories.'),
  ('baby-kids','Baby Clothes','baby-clothes','Clothing and outfits for babies.'),
  ('baby-kids','Baby Shoes','baby-shoes','Footwear for babies and toddlers.'),
  ('baby-kids','Toys','baby-kids-toys','Toys and playtime finds.'),
  ('baby-kids','Feeding','baby-feeding','Baby feeding essentials.'),
  ('baby-kids','Nursery','baby-nursery','Nursery and baby-room essentials.'),
  ('baby-kids','Baby Accessories','baby-accessories','Everyday baby accessories.'),
  ('home-living','Home Decor','home-decor','Decor and styling finds.'),
  ('home-living','Kitchen','home-kitchen','Kitchen tools and essentials.'),
  ('home-living','Bedroom','home-bedroom','Bedroom essentials.'),
  ('home-living','Bathroom','home-bathroom','Bathroom essentials.'),
  ('home-living','Storage & Organization','home-storage','Organization and storage.'),
  ('electronics','Phones & Accessories','electronics-phone','Phone accessories and mobile gadgets.'),
  ('electronics','Computer Accessories','electronics-computer','Computer and desk tech.'),
  ('electronics','Audio','electronics-audio','Headphones, speakers and audio gear.'),
  ('electronics','Smart Gadgets','electronics-smart','Smart and connected gadgets.'),
  ('electronics','Gaming','electronics-gaming','Gaming gear and accessories.'),
  ('beauty-personal-care','Skincare','beauty-skincare','Skincare and self-care products.'),
  ('beauty-personal-care','Hair','beauty-hair','Hair care and styling.'),
  ('beauty-personal-care','Makeup','beauty-makeup','Makeup and cosmetics.'),
  ('beauty-personal-care','Beauty Tools','beauty-tools','Beauty tools and accessories.'),
  ('sports-fitness','Gym','sports-gym','Gym and workout essentials.'),
  ('sports-fitness','Outdoor','sports-outdoor','Outdoor and active lifestyle.'),
  ('sports-fitness','Sports Accessories','sports-accessories','Sports accessories and equipment.'),
  ('automotive','Car Accessories','auto-accessories','Useful car accessories.'),
  ('automotive','Interior','auto-interior','Car interior products.'),
  ('automotive','Exterior','auto-exterior','Car exterior products.'),
  ('automotive','Car Gadgets','auto-gadgets','Useful automotive gadgets.'),
  ('pets','Pet Clothing','pets-clothing','Pet clothing and wearables.'),
  ('pets','Pet Toys','pets-toys','Toys and enrichment for pets.'),
  ('pets','Pet Feeding','pets-feeding','Feeding and care essentials.'),
  ('pets','Pet Accessories','pets-accessories','Everyday pet accessories.'),
  ('gifts-lifestyle','Gifts','gifts','Gift ideas and giftable finds.'),
  ('gifts-lifestyle','Trending Finds','trending-finds','Popular and interesting discoveries.'),
  ('gifts-lifestyle','Seasonal','seasonal','Seasonal products and occasions.'),
  ('gifts-lifestyle','Everyday Essentials','everyday-essentials','Useful everyday products.')
)
insert into public.categories(name,slug,description,parent_id)
select s.name,s.slug,s.description,r.id from subs s join root_map r on r.slug=s.root_slug
on conflict(slug) do update set description=excluded.description,parent_id=excluded.parent_id;

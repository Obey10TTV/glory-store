const mongoose = require('mongoose')
const dotenv = require('dotenv')
dotenv.config()

const Product = require('./models/product')
const User = require('./models/user')

const products = [
  // SKINCARE
  {
    name: 'Vitamin C Brightening Serum',
    price: 8500,
    description: 'Powerful Vitamin C serum with Niacinamide to brighten skin, fade dark spots and give you that glass skin glow.',
    category: 'Skincare',
    image: 'https://images.pexels.com/photos/4041392/pexels-photo-4041392.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Nuban Skin',
    countInStock: 50
  },
  {
    name: 'Rosehip Glow Face Oil',
    price: 11200,
    description: 'Lightweight rosehip oil packed with vitamins A and C to reduce fine lines, brighten skin tone and fade dark spots.',
    category: 'Skincare',
    image: 'https://images.pexels.com/photos/3762879/pexels-photo-3762879.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Zaron',
    countInStock: 30
  },
  {
    name: 'SPF 50 Daily Sunscreen',
    price: 9800,
    description: 'Lightweight daily sunscreen with SPF 50 protection. No white cast. Suitable for all Nigerian skin tones.',
    category: 'Skincare',
    image: 'https://images.pexels.com/photos/4465124/pexels-photo-4465124.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Dr. Sheth\'s',
    countInStock: 45
  },
  {
    name: 'Hyaluronic Acid Moisturiser',
    price: 7500,
    description: 'Deep hydration moisturiser with hyaluronic acid and ceramides. Perfect for dry and combination skin.',
    category: 'Skincare',
    image: 'https://images.pexels.com/photos/4465124/pexels-photo-4465124.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'CeraVe',
    countInStock: 60
  },
  {
    name: 'Kojic Acid Dark Spot Corrector',
    price: 6500,
    description: 'Targets hyperpigmentation, acne scars and uneven skin tone. Formulated for melanin-rich skin.',
    category: 'Skincare',
    image: 'https://images.pexels.com/photos/3985338/pexels-photo-3985338.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Tonique',
    countInStock: 40
  },
  {
    name: 'Gentle Foaming Cleanser',
    price: 4500,
    description: 'Sulfate-free foaming cleanser that removes makeup, excess oil and impurities without stripping the skin.',
    category: 'Skincare',
    image: 'https://images.pexels.com/photos/4041392/pexels-photo-4041392.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Neutrogena',
    countInStock: 70
  },

  // HAIRCARE
  {
    name: 'Rosemary Mint Hair Growth Oil',
    price: 11000,
    description: 'Strengthening hair oil with rosemary and mint to promote growth, reduce breakage and nourish the scalp.',
    category: 'Haircare',
    image: 'https://images.pexels.com/photos/3065209/pexels-photo-3065209.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Mielle',
    countInStock: 45
  },
  {
    name: 'Deep Moisture Hair Mask',
    price: 8000,
    description: 'Intensive moisture treatment for natural and relaxed hair. Restores softness, shine and elasticity.',
    category: 'Haircare',
    image: 'https://images.pexels.com/photos/3993449/pexels-photo-3993449.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Shea Moisture',
    countInStock: 35
  },
  {
    name: 'Jamaican Black Castor Oil',
    price: 6500,
    description: 'Pure Jamaican Black Castor Oil for hair growth, scalp nourishment and edge control.',
    category: 'Haircare',
    image: 'https://images.pexels.com/photos/3065209/pexels-photo-3065209.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Tropic Isle',
    countInStock: 55
  },
  {
    name: 'Curl Defining Cream',
    price: 7200,
    description: 'Defines and enhances natural curls without crunch. Adds moisture and reduces frizz for all curl types.',
    category: 'Haircare',
    image: 'https://images.pexels.com/photos/3993449/pexels-photo-3993449.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Cantu',
    countInStock: 40
  },

  // MAKEUP
  {
    name: 'Gloss Bomb Lip Gloss',
    price: 13000,
    description: 'Ultra-shiny lip gloss that gives your lips a plump, glossy finish with a hint of colour. Available in 12 shades.',
    category: 'Makeup',
    image: 'https://images.pexels.com/photos/2113855/pexels-photo-2113855.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Fenty Beauty',
    countInStock: 60
  },
  {
    name: 'Full Coverage Foundation',
    price: 15000,
    description: 'Buildable full coverage foundation with SPF 15. 40 shades for every skin tone including deep Nigerian complexions.',
    category: 'Makeup',
    image: 'https://images.pexels.com/photos/2113855/pexels-photo-2113855.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Black Opal',
    countInStock: 35
  },
  {
    name: 'Matte Liquid Lipstick',
    price: 8500,
    description: 'Long-lasting matte liquid lipstick that stays put all day. Available in bold African-inspired shades.',
    category: 'Makeup',
    image: 'https://images.pexels.com/photos/2113855/pexels-photo-2113855.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Zaron',
    countInStock: 50
  },
  {
    name: 'Highlighter Palette',
    price: 12000,
    description: 'Six stunning highlighter shades from champagne to bronze. Buildable glow that complements melanin-rich skin.',
    category: 'Makeup',
    image: 'https://images.pexels.com/photos/2113855/pexels-photo-2113855.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'House of Tara',
    countInStock: 25
  },

  // BODY CARE
  {
    name: 'Shea Butter Body Cream',
    price: 5200,
    description: 'Rich moisturising body cream with raw shea butter to deeply nourish and soften skin. 100% natural ingredients.',
    category: 'Body Care',
    image: 'https://images.pexels.com/photos/3373736/pexels-photo-3373736.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Nubian Heritage',
    countInStock: 80
  },
  {
    name: 'Turmeric Glow Body Scrub',
    price: 6800,
    description: 'Exfoliating body scrub with turmeric and sugar crystals to buff away dead skin and reveal radiant glow.',
    category: 'Body Care',
    image: 'https://images.pexels.com/photos/3373736/pexels-photo-3373736.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Nativechild',
    countInStock: 45
  },
  {
    name: 'Collagen Body Lotion',
    price: 7500,
    description: 'Firming body lotion with collagen and elastin to improve skin elasticity and reduce the appearance of stretch marks.',
    category: 'Body Care',
    image: 'https://images.pexels.com/photos/3373736/pexels-photo-3373736.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Bio-Oil',
    countInStock: 55
  },

  // NAILS
  {
    name: 'Gel Nail Polish Set',
    price: 9500,
    description: 'Long-lasting gel nail polish set with 6 trending shades. Chip-resistant formula lasts up to 3 weeks.',
    category: 'Nails',
    image: 'https://images.pexels.com/photos/3622613/pexels-photo-3622613.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'OPI',
    countInStock: 40
  },
  {
    name: 'Nail Growth Serum',
    price: 5500,
    description: 'Strengthening nail serum with biotin and keratin to promote nail growth and prevent breakage.',
    category: 'Nails',
    image: 'https://images.pexels.com/photos/3622613/pexels-photo-3622613.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Sally Hansen',
    countInStock: 60
  },

  // LASHES
  {
    name: '3D Mink Lashes',
    price: 8000,
    description: 'Handcrafted 3D mink lashes for a natural yet dramatic look. Reusable up to 25 times with proper care.',
    category: 'Lashes',
    image: 'https://images.pexels.com/photos/2253833/pexels-photo-2253833.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Lash Luxe',
    countInStock: 50
  },
  {
    name: 'Magnetic Lashes Kit',
    price: 12000,
    description: 'No-glue magnetic lash kit with applicator. Easy to apply and remove. Comes with 3 styles.',
    category: 'Lashes',
    image: 'https://images.pexels.com/photos/2253833/pexels-photo-2253833.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Ardell',
    countInStock: 30
  },

  // FRAGRANCE
  {
    name: 'Oud & Rose Perfume',
    price: 28000,
    description: 'Luxurious Arabic-inspired fragrance with notes of oud, rose and amber. Long-lasting 12-hour wear.',
    category: 'Fragrance',
    image: 'https://images.pexels.com/photos/965989/pexels-photo-965989.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Rasasi',
    countInStock: 20
  },
  {
    name: 'Floral Body Mist',
    price: 6500,
    description: 'Light refreshing body mist with notes of jasmine, peach and vanilla. Perfect for everyday wear.',
    category: 'Fragrance',
    image: 'https://images.pexels.com/photos/965989/pexels-photo-965989.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Victoria\'s Secret',
    countInStock: 65
  },

  // SCENTED CANDLES
  {
    name: 'Shea & Coconut Luxury Candle',
    price: 14000,
    description: 'Hand-poured soy wax candle with shea butter and coconut fragrance. 40-hour burn time.',
    category: 'Scented Candles',
    image: 'https://images.pexels.com/photos/3270223/pexels-photo-3270223.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Lagos Lights',
    countInStock: 25
  },
  {
    name: 'Oud & Amber Candle',
    price: 18000,
    description: 'Premium oud and amber scented candle in a reusable glass jar. Creates a warm luxurious atmosphere.',
    category: 'Scented Candles',
    image: 'https://images.pexels.com/photos/3270223/pexels-photo-3270223.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Abuja Aroma',
    countInStock: 20
  },

  // BODY LIQUID
  {
    name: 'African Black Soap Body Wash',
    price: 5800,
    description: 'Traditional African black soap body wash with shea butter. Cleanses, moisturises and evens skin tone.',
    category: 'Body Liquid',
    image: 'https://images.pexels.com/photos/3373736/pexels-photo-3373736.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Shea Moisture',
    countInStock: 70
  },
  {
    name: 'Vitamin C Shower Gel',
    price: 4800,
    description: 'Brightening vitamin C shower gel that cleanses and brightens skin with every wash.',
    category: 'Body Liquid',
    image: 'https://images.pexels.com/photos/3373736/pexels-photo-3373736.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'TBS',
    countInStock: 55
  },

  // TOOLS
  {
    name: 'Gua Sha & Jade Roller Set',
    price: 9500,
    description: 'Premium jade roller and gua sha set for facial massage, lymphatic drainage and skincare absorption.',
    category: 'Tools & Accessories',
    image: 'https://images.pexels.com/photos/3762879/pexels-photo-3762879.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Mount Lai',
    countInStock: 35
  },
  {
    name: 'Makeup Brush Set 12pcs',
    price: 11500,
    description: 'Professional 12-piece makeup brush set with synthetic bristles. Includes foundation, contour and eyeshadow brushes.',
    category: 'Tools & Accessories',
    image: 'https://images.pexels.com/photos/2113855/pexels-photo-2113855.jpeg?auto=compress&cs=tinysrgb&w=400',
    brand: 'Sigma Beauty',
    countInStock: 40
  },
]

const seedProducts = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    console.log('MongoDB connected')
    
    // Clear existing products
await Product.deleteMany({})
console.log('Existing products cleared')

    // Get admin user
    const adminUser = await User.findOne({ isAdmin: true })
    if (!adminUser) {
      console.log('No admin user found! Please create one first.')
      process.exit(1)
    }

    // Add seller to each product
    const productsWithSeller = products.map(p => ({
      ...p,
      seller: adminUser._id
    }))

    // Insert products
    await Product.insertMany(productsWithSeller)
    console.log(`✅ ${products.length} products added successfully!`)
    process.exit(0)

  } catch (error) {
    console.log('Error:', error.message)
    process.exit(1)
  }
}

seedProducts()

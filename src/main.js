/**
 * Функция для расчета выручки
 * @param purchase запись о покупке
 * @param _product карточка товара
 * @returns {number}
 */
function calculateSimpleRevenue(purchase, _product) {
  // purchase - это одна из записей в поле items из чека в data.purchase_records
  // _product - это продукт из коллекции data.products
  const { discount, sale_price, quantity } = purchase;

  // Ensure discount is between 0 and 100
  const safeDiscount = Math.max(0, Math.min(discount, 100));

  // Discounted selling price per unit
  const discountedPrice = sale_price * (1 - safeDiscount / 100);

  // Revenue from the unit
  const revenue = discountedPrice * quantity;

  return revenue;
}

/**
 * Функция для расчета бонусов
 * @param index порядковый номер в отсортированном массиве
 * @param total общее число продавцов
 * @param seller карточка продавца
 * @returns {number}
 */

function calculateBonusByProfit(index, total, seller) {
  // index - position in sorted list (0 = best)
  // total - total number of sellers
  if (total === 1) return 0

  const { profit } = seller;

  if (index === 0) {
    return profit * 0.15;
  } else if (index <= 2) {
    return profit * 0.10;
  } else if (index === total - 1) {
    return 0;
  } else {
    return profit * 0.05;
  }
}

/**
 * Функция для анализа данных продаж
 * @param data
 * @param options
 * @returns {{revenue, top_products, bonus, name, sales_count, profit, seller_id}[]}
 */

function analyzeSalesData(data, options = {}) {
  const {
    calculateRevenue = calculateSimpleRevenue,
    calculateBonus = calculateBonusByProfit
  } = options;

  // Validate input data
  if (!data ||
    !Array.isArray(data.sellers) ||
    data.sellers.length === 0 ||
    !Array.isArray(data.purchase_records) ||
    data.purchase_records.length === 0 ||
    !Array.isArray(data.products) ||
    data.products.length === 0
  ) {
    throw new Error("Некорректные входные данные - отсутствуют продавцы, товары или записи о покупках.");
  }

  // Indexing goods by SKU for quick access
  const productsMap = new Map();
  data.products.forEach(product => {
    if (product && typeof product.sku === "string") {
      productsMap.set(product.sku, product);
    }
  });

  // Indexing sellers: key - seller_id, value - an object with accumulated
  // profit and initial data
  const sellersMap = new Map();
  data.sellers.forEach(seller => {
    if (!seller || typeof seller.id !== "string") {
      throw new Error(`Продавец без валидного id: ${JSON.stringify(seller)}`);
    }
    sellersMap.set(seller.id, {
      seller_id: seller.id,
      name: `${seller.first_name} ${seller.last_name}`,
      revenue: 0,
      profit: 0,
      sales_count: 0,
      products_sold: new Map() // key - SKU, value - total quantity sold
    });
  });

  if (sellersMap.size === 0) {
    throw new Error("Нет валидных продавцов для анализа.");
  }

  // Calculation of profit for each check and each item
  data.purchase_records.forEach((receipt, receiptIndex) => {
    if (!receipt || typeof receipt.seller_id !== "string") {
      throw new Error(`Чек #${receiptIndex} пропущен: нет seller_id.`);
    }

    const seller = sellersMap.get(receipt.seller_id);

    if (!Array.isArray(receipt.items)) {
      throw new Error(`В чеке #${receiptIndex} поле items не является массивом.`);
    }

    receipt.items.forEach((item, itemIndex) => {
      if (!item ||
        typeof item.sku !== "string" ||
        typeof item.quantity !== "number" ||
        item.quantity <= 0
      ) {
        throw new Error(`Позиция #${itemIndex} в чеке #${receiptIndex} имеет некорректные данные (sku или quantity).`);
      }
      const product = productsMap.get(item.sku);
      if (!product) {
        throw new Error(`В позиции #${itemIndex} чека #${receiptIndex} товар с SKU ${item.sku} не найден в данных о продуктах.`);
      }

      const revenue = calculateRevenue(item, product);

      const safeDiscount = Math.max(0, Math.min(item.discount, 100));
      const discountedPrice = item.sale_price * (1 - safeDiscount / 100);
      const profit = (discountedPrice * item.quantity) - (product.purchase_price * item.quantity);

      seller.revenue += revenue;
      seller.profit += profit;
      seller.sales_count += item.quantity;

        // Accumulate quantity sold for each product
        const currentQuantity = seller.products_sold.get(item.sku) || 0;
        seller.products_sold.set(item.sku, currentQuantity + item.quantity);
    });
  });

  // Convert to an array for sorting
  const sellerList = Array.from(sellersMap.values());

  // Sort sellers by profit in descending order
  sellerList.sort((a, b) => b.profit - a.profit);


  // Calculate bonuses based on sorted order
  const total = sellerList.length;
  if (total === 0) {
    throw new Error("После валидации не осталось продавцов для расчёта");
  }

  const result = sellerList.map((seller, index) => {
    // Forming the top 10 products by quantity sold
    const topProducts = Array.from(seller.products_sold.entries())
      .map(([sku, quantity]) => ({ sku, quantity }))
      .sort((a, b) => b.quantity - a.quantity) // sort by quantity sold
      .slice(0, 10); // take top 10

    let bonus = calculateBonus(index, total, seller);

    // Bonus cannot be negative, if the calculation logic allows for that
    if (bonus < 0) {
      bonus = 0;
    }

    return {
      seller_id: seller.seller_id,
      name: seller.name,
      revenue: Math.round(seller.revenue * 100) / 100, // rounding to 2 decimal places
      profit: Math.round(seller.profit * 100) / 100, // rounding to 2 decimal places
      sales_count: seller.sales_count,
      top_products: topProducts,
      bonus: Math.round(bonus * 100) / 100 // rounding to 2 decimal places
    };
  });

  return result;
}

/**
 * Функция для расчета выручки
 * @param purchase запись о покупке
 * @param _product карточка товара
 * @returns {number}
 */
function calculateSimpleRevenue(purchase, _product) {
  // purchase - это одна из записей в поле items из чека в data.purchase_records
  // _product - это продукт из коллекции data.products

  // Validation of input data
  if (!purchase || typeof purchase.sale_price !== "number" || purchase.sale_price < 0) {
    throw new Error("Некорректное значение sale_price в позиции чека");
  }
  if (typeof purchase.quantity !== "number" || purchase.quantity <= 0 || !Number.isFinite(purchase.quantity)) {
    throw new Error("Некорректное значение quantity в позиции чека");
  }
  if (typeof purchase.discount !== "number") {
    throw new Error("Некорректное значение discount в позиции чека");
  }
  if (!_product || typeof _product.purchase_price !== "number" || _product.purchase_price < 0) {
    throw new Error("Некорректные данные товара (отсутствует purchase_price)");
  }

  const { discount, sale_price, quantity } = purchase;

  // Ensure discount is between 0 and 100
  const safeDiscount = Math.max(0, Math.min(discount, 100));

  // Discounted selling price per unit
  const discountedPrice = sale_price * (1 - safeDiscount / 100);

  // Revenue from the unit
  const revenue = discountedPrice * quantity;

  // Profit from the unit: revenue minus purchase price
  const profit = revenue - (_product.purchase_price * quantity);

  return { revenue, profit };
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
    data.purchase_records.length === 0
  ) {
    throw new Error("Некорректные входные данные - отсутствуют продавцы, товары или записи о покупках.");
  }

  // Validate sellers data
  if (!Array.isArray(data.sellers)) {
    throw new Error("Поле sellers должно быть массивом.");
  }
  if (data.sellers.length === 0) {
    // We can return an empty array or throw an error - here we return an empty array
    return [];
  }

  // Validate purchase_records data
  if (!Array.isArray(data.purchase_records)) {
    throw new Error("Поле purchase_records должно быть массивом (даже пустым).");
  }

  // Indexing goods by SKU for quick access
  const productsMap = new Map();
  if (Array.isArray(data.products)) {
    data.products.forEach(product => {
      if (product && typeof product.sku === "string") {
        productsMap.set(product.sku, product);
      }
    });
  }

  // Indexing sellers: key - seller_id, value - an object with accumulated
  // profit and initial data
  const sellersMap = new Map();
  data.sellers.forEach(seller => {
    if (!seller || typeof seller.id !== "string") {
      // Skipping sellers without valid id
      return;
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
    return [];
  }

  // Calculation of profit for each check and each item
  data.purchase_records.forEach((receipt, receiptIndex) => {
    if (!receipt || typeof receipt.seller_id !== "string") {
      // We can log: console.warn(`Чек #${receiptIndex} пропущен пропущен: нет seller_id.`);
      return;
    }

    const seller = sellersMap.get(receipt.seller_id);

    if (!seller) {
      // If seller from receipt is missing in sellers collection - skip OR throw
      // an error
      return;
    }

    if (!Array.isArray(receipt.items)) {
      // If items is missing or not an array - skip the receipt
      return;
    }

    receipt.items.forEach((item, itemIndex) => {
      if (!item ||
        typeof item.sku !== "string" ||
        typeof item.quantity !== "number" ||
        item.quantity <= 0
      ) {
        // Skipping invalid item in receipt
        return;
      }
      const product = productsMap.get(item.sku);

      try {
        const { revenue, profit } = calculateRevenue(item, product);

        seller.revenue += revenue;
        seller.profit += profit;
        seller.sales_count += item.quantity;

        // Accumulate quantity sold for each product
        const currentQuantity = seller.products_sold.get(item.sku) || 0;
        seller.products_sold.set(item.sku, currentQuantity + item.quantity);
      } catch (error) {
        // If a position causes a validation error, simply skip it.
        // We can log error.message in debug
        // console.warn(`Позиция #${itemIndex} в чеке #${receiptIndex} пропущена: ${error.message}`);
        return;
      }
    });
  });

  // Convert to an array for sorting
  const sellerList = Array.from(sellersMap.values());

  // Sort sellers by profit in descending order
  sellerList.sort((a, b) => b.profit - a.profit);


  // Calculate bonuses based on sorted order
  const total = sellerList.length;
  if (total === 0) {
    return [];
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

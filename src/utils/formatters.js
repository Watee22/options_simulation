// src/utils/formatters.js

export const formatCurrency = (value) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
};

export const formatGreeks = (value) => {
  if (value === undefined || value === null || isNaN(value)) return '-';
  return value.toFixed(4);
};

// Calculate Time to Maturity (T) in years
export const calculateTimeInYears = (currentDateStr, endDateStr) => {
  const currentDate = new Date(currentDateStr);
  const endDate = new Date(endDateStr);
  
  // Set time component to 0 for pure day diff
  currentDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);
  
  const diffTime = endDate - currentDate;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  // Max(0, days) / 365
  return Math.max(0, diffDays) / 365;
};

export const getDaysToExpiration = (currentDateStr, endDateStr) => {
  const currentDate = new Date(currentDateStr);
  const endDate = new Date(endDateStr);
  
  currentDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);
  
  const diffTime = endDate - currentDate;
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
};

const CLOSED_ROUTE=/^#closed-trade\?/i;

function closeClosedTradeOnce(e){
  const btn=e.target?.closest?.('.closed-log-overlay [data-closed-close]');
  if(!btn || !CLOSED_ROUTE.test(location.hash)) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  const oldHash=location.hash;
  btn.closest('.closed-log-overlay')?.remove();

  history.back();

  // Fallback for a directly opened closed-trade URL with no usable prior app route.
  setTimeout(()=>{
    if(location.hash===oldHash){
      location.hash='#dashboard';
    }
  },180);
}

document.addEventListener('click',closeClosedTradeOnce,true);

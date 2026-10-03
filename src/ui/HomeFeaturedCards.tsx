/** A compact single-image campaign composition, including on narrow screens. */
export default function HomeFeaturedCards() {
  return (
    <div className="portal-card-banner">
      <img
        src={`${import.meta.env.BASE_URL}promo/cards-feature.webp`}
        alt="开瓦包宣传图：曼谷 ZmjjKK、彩卡 Jinggg、普卡 Babybay、彩卡 Boaster"
        width={1536}
        height={640}
        fetchPriority="high"
      />
    </div>
  )
}

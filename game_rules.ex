defmodule KurtenWeb.HomeHTML.GameRules do
  use KurtenWeb, :html

  def game_rules(assigns) do
    ~H"""
    <div class="text-xs">
      <h1 class="text-lg">How to play</h1>

      <br />
      <h2 class="text-md font-semibold">Objective</h2>
      <p>The aim is to reach 21 or get as close as possible without exceeding 21.</p>

      <br />
      <h2 class="text-md font-semibold">Components</h2>
      <p>Minimum of 2 players (3 or more recommended)</p>

      <br />
      <h2 class="text-md font-semibold">Rules</h2>
      <ul>
        <li>
          <strong>Banker:</strong>
          One player acts as the Banker, while all other players compete against them.
        </li>
        <li><strong>Betting:</strong> Each player receives a card and places their bet.</li>
        <li><strong>Drawing Cards:</strong> Players may request additional cards one at a time.</li>
        <li>
          <strong>Hitting 21:</strong>
          Achieving exactly 21 points results in an automatic win, with the player's cards being revealed.
        </li>
        <li>
          <strong>Exceeding 21:</strong>
          Surpassing 21 points leads to an automatic loss, and the player's cards are shown.
        </li>
        <li>
          <strong>Standing:</strong>
          Players have the option to stop drawing cards at any point, known as "standing".
        </li>
        <li>
          <strong>Banker's Turn:</strong>
          The Banker plays last, drawing cards face down but keeping the initial card face-up.
        </li>
        <li>
          <strong>Banker Hits 21:</strong> If the Banker hits exactly 21, they win all standing bets.
        </li>
        <li>
          <strong>Banker Exceeds 21:</strong>
          If the Banker goes over 21, players win their standing bets.
        </li>
        <li>
          <strong>Comparing Scores:</strong>
          If the Banker stops before reaching 21, players with lower or equal scores lose their bets. Players win with a score higher than the Banker's, without exceeding 21.
        </li>
      </ul>

      <br />
      <h2 class="text-md font-semibold">Special Card Rules</h2>
      <ul>
        <li>
          <strong>#12 Card:</strong>
          The #12 card can be valued as a 12, 10, or 9. Achieving a total of 21 with these values results in a win. Drawing two #12 cards initially equals an automatic 21 and an automatic win.
        </li>
        <li>
          <strong>Frame Cards (#2 and #11):</strong>
          Drawing two Frame Cards initially is considered an "Automatic 21," leading to an automatic win.
        </li>
      </ul>
    </div>
    """
  end
end

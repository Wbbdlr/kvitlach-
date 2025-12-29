defmodule Kurten.Turn do
  alias Kurten.Turn

  @moduledoc """
    possible states for a turn
    1. pending. player can still choose another card
    2. lost
    3. won
    4. standby
    5. player is skipped
  """
  defstruct [:player, state: :pending, cards: [], bet: 0]

  def calc_state(cards) do
    sums = get_sums(cards)

    cond do
      21 in sums -> :won
      rosier?(cards) -> :won
      Enum.all?(sums, &(&1 > 21)) -> :lost
      true -> :pending
    end
  end

  def get_sums(cards) do
    values = Enum.map(cards, fn card -> card.attributes.values end)
    calc_sums(values)
  end

  def initialize(players, deck) do
    {turns, deck} =
      Enum.map_reduce(players, deck, fn player, [card | rest] ->
        {%Turn{player: player, cards: [card]}, rest}
      end)

    [turns: turns, deck: deck]
  end

  defp rosier?(cards) do
    length(cards) == 2 and
      Enum.all?(cards, fn card -> Enum.any?(card.attributes, fn {_k, v} -> v == "rosier" end) end)
  end

  @doc "calculate all possible sums of cards, since a card can have more than one value"
  def calc_sums(values) do
    Enum.reduce(values, fn x, acc ->
      get_combinations(x, acc)
      |> List.flatten()
    end)
  end

  @doc "gets the all the combinations of 2 lists"
  def get_combinations(sums_a, sums_b) do
    for a <- sums_a do
      for b <- sums_b do
        a + b
      end
    end
  end
end

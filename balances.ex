# defmodule Kurten.Balances do
#  def simplify_with_collector(balances) do
#    for {person, balance} <- balances do
#
#    end
#  end
#
# return [(collector, person, balance) for (person, balance)
# in balances.items() if person != collector]
#
#                                 def show_transactions(transactions):
# for (debtor, creditor, value) in transactions:
#                                 if value > 0:
#                                 print(f"{debtor} owes {creditor} ${value}")
#                                      else:
#                                      print(f"{creditor} owes {debtor} ${-value}")
#
#                                           collector_transactions = simplify_with_collector(compute_balances(debts))
# show_transactions(collector_transactions)
# end
#
# def compute_balances(debts):
#                    balances = {person: 0 for person in people}
#                                        for (debtor, creditor, value) in debts:
#                                                     balances[debtor] -= value
#                                                             balances[creditor] += value
#                                                                     return balances
# compute_balances(debts)

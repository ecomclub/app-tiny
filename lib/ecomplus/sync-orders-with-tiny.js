const newTinyPedido = require('./../tiny/new-pedido')

module.exports = ({ logger, ecomClient, mysql, getStores, MapStores, appSdk, tinyClient }) => {
  logger.log('>> Sync orders - OK')

  const sync = () => new Promise(async (resolve, reject) => {
    const callback = function (configObj, storeId, next, current, err) {
      if (err && storeId) {
        logger.error('SyncError:Order', storeId, err)
        return next()
      } else if (!next && !err && !storeId && !configObj) {
        return resolve()
      }
      logger.log('SyncOrders: Iniciado para #' + storeId)
      // stuffs
      if (!configObj.access_token) {
        return next()
      }

      const token = configObj.access_token

      appSdk.getAuth(storeId).then(({ myId, accessToken }) => {
        let syncErrors = []
        let retry = 0
        const sql = 'select * from orders ' +
          'where store_id = ? ' +
          'and error = ? ' +
          'and tiny_id is null ' +
          'order by order_number desc ' +
          'limit 20'

        const getListOfOrders = () => mysql.query(sql, [storeId, 0])

        const doSync = (listOfOrders, queue = 0, success = 0, failed = 0) => {
          const nextOrder = () => {
            queue++
            return doSync(listOfOrders, queue, success, failed)
          }

          if (!listOfOrders || !listOfOrders[queue] || !listOfOrders[queue]._id) {
            const lastSync = {
              storeId,
              total: listOfOrders.length,
              success,
              failed,
              errors: syncErrors
            }

            let fn = null
            if (lastSync.total >= 1) {
              logger.log('SyncOrders: Terminou ', JSON.stringify(lastSync, undefined, 4))
              fn = mysql.saveSync(listOfOrders.length, success, failed, storeId, syncErrors)
                .then(() => console.log('Sincronização concluida.'))
            }
            return next(fn)
          }

          const order = listOfOrders[queue]

          const url = `/orders/${order._id}.json`
          const reqConfig = { url, storeId, authenticationId: myId, accessToken }
          ecomClient.store(reqConfig).then(({ data }) => {
            return newTinyPedido(data, configObj)
          })

            .then(newPedido => {
              return tinyClient({
                url: 'pedido.incluir.php',
                params: {
                  pedido: JSON.stringify(newPedido)
                },
                token
              }, true)
            })

            .then(({ registro }) => {
              success++
              console.log('>> Pedido enviado: ', order.order_number)
              return mysql.updateTinyIdOrder(registro.id, order.order_number, storeId)
            })

            .then(nextOrder)

            .catch(err => {
              // store-api error?
              if (err.response && err.response.status >= 500) {
                if (retry <= 4) {
                  setTimeout(() => {
                    return doSync(listOfOrders, queue, success)
                  }, 4000)
                  retry++
                } else {
                  return nextOrder()
                }
              } else if (err.isTinyError) {
                const { tinyError, retorno } = err
                switch (err.code) {
                  case 6:
                    console.log('<< WAIT! API LIMIT')
                    setTimeout(() => {
                      // wait 1m and try to sync current order again 🙏
                      return doSync(listOfOrders, queue, success, failed)
                    }, 1 * 60 * 1000)
                    break
                  case 31:
                    failed++
                    syncErrors.push({
                      resource: 'orders',
                      resource_id: order._id,
                      message: tinyError,
                      retorno
                    })

                    const sql = 'update orders ' +
                      'set error = ? ' +
                      'where _id = ?'
                    mysql.query(sql, [1, order._id]).then(nextOrder)
                    break
                  case 30:
                    const number = order.order_number
                    tinyClient({
                      url: 'pedidos.pesquisa.php',
                      params: {
                        numeroEcommerce: number
                      },
                      token
                    }, true)
                      .then(({ pedidos }) => {
                        console.log('Pedido ja existia no tiny, salvando só o id dele', pedidos[0].id)
                        success++
                        return mysql
                          .updateTinyIdOrder(pedidos[0].id, number, storeId)
                      })
                      .then(nextOrder)
                      .catch(error => {
                        const { retorno } = error
                        if (error.code === 6) {
                          console.log('WAIT! API LIMIT, AGAIN :(')
                          setTimeout(() => {
                            // wait 1m and try to sync current order again 🙏
                            return doSync(listOfOrders, queue, success, failed)
                          }, 1 * 60 * 1000)
                        } else {
                          failed++
                          // push erro to array of erros
                          syncErrors.push({
                            resource: 'orders',
                            resource_id: order._id,
                            message: tinyError,
                            retorno
                          })

                          const sql = 'update orders ' +
                            'set error = ? ' +
                            'where _id = ?'
                          mysql.query(sql, [1, order._id]).then(nextOrder)
                        }
                      })
                    break
                  default:
                    nextOrder()
                    break
                }
              } else {
                logger.log('SyncOrders: Falhou ', err)
                nextOrder()
              }
            })
        }

        return getListOfOrders().then(listOfOrders => {
          if (listOfOrders && listOfOrders.length) {
            logger.log('SyncOrders: Total de pedidos:  ' + listOfOrders.length)
          }
          return doSync(listOfOrders)
        })
      }).catch((e) => {
        logger.error('AuthErr', e)
        next() // next store
      })
    }

    const mp = new MapStores(appSdk)
    const stores = await getStores().catch(reject)
    mp.tasks(stores, callback)
  })

  const start = () => sync().finally(() => setTimeout(() => start(), 1 * 30 * 1000))
  // start after 30s
  //setTimeout(() => start(), 1 * 80 * 1000)
  start()
}
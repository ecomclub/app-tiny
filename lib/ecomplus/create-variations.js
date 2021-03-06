const logger = require('console-files')

module.exports = (produtoBody, tinyClient, token, mysql, appSdk, storeId, productBody) => {
  logger.log(`>> Criando novas ${produtoBody.variacoes.length} variações para o produto: ${productBody.sku}`)
  const doSync = async (variacoes, queue = 0) => {
    if (variacoes[queue]) {
      const variacao = variacoes[queue].variacao
      await tinyClient({
        url: 'produto.obter.php',
        params: {
          id: variacao.id
        },
        token,
      }, true).then(async ({ produto }) => {
        const saldo = await tinyClient({
          url: 'produto.obter.estoque.php',
          params: {
            id: produto.id
          },
          token
        }, true).then(payload => {
          return payload.produto.saldo
        }).catch(error => {
          if (error.code === 6) {
            setTimeout(() => {
              return doSync(variacoes, queue)
            }, 1 * 60 * 1000)
          } else if (error.code === 32) {
            return 0
          } else {
            queue++
            return doSync(variacoes, queue)
          }
        })

        produto.saldo = saldo
        return produto
      }).then(produto => {
        const variation = {
          sku: getSku(produto),
          name: produto.nome,
          gtin: getGtin(produto),
          price: Number(produto.preco),
          cost_price: Number(produto.preco_custo),
          quantity: (produto.saldo && produto.saldo > 0) ? produto.saldo : 0,
          weight: {
            value: parseFloat(produto.peso_bruto),
            unit: 'kg'
          },
          dimensions: {
            width: {
              value: parseFloat(produto.larguraEmbalagem) || 0,
              unit: 'cm'
            },
            height: {
              value: parseFloat(produto.alturaEmbalagem) || 0,
              unit: 'cm'
            },
            length: {
              value: parseFloat(produto.comprimentoEmbalagem) || 0,
              unit: 'cm'
            }
          }
        }

        // specifications
        if (variacao.hasOwnProperty('grade')) {
          variation.specifications = {}
          for (const key in variacao.grade) {
            const k = key.replace(/\W+/g, " ")
              .split(/ |\B(?=[A-Z])/)
              .map(c => c.toLowerCase())
              .join('_')

            if (variacao.grade.hasOwnProperty(key)) {
              const specification = {
                text: variacao.grade[key]
                // value: variacao.grade[k]
              }
              variation.specifications[k] = variation.specifications[k] || []
              variation.specifications[k].push(specification)
            }
          }
        }

        const syncVariation = (variation) => {
          const url = `/products/${productBody._id}/variations.json`
          const promise = appSdk
            .apiRequest(storeId, url, 'post', variation).then(({ data }) => {
              return mysql.insertVariations(variation, productBody._id, productBody.sku, storeId)
            }).then(() => {
              console.log('>> Variação enviada com sucesso: ' + variacao.id)
              queue++
              doSync(variacoes, queue)
            })
            .catch(err => {
              const { response } = err
              if (response.status && response.status >= 500) {
                // ddos?
                setTimeout(() => {
                  return Promise.resolve(syncVariation(variation))
                }, 4000);
              } else {
                // logger.error
                if (err.response) {
                  const { response } = err
                  const { data } = response
                  logger.error('UnexpectedErrVariation', JSON.stringify(data))
                }
                queue++
                doSync(variacoes, queue)
              }
            })

          return Promise.resolve(promise)
        }

        syncVariation(variation)

      }).catch(err => {
        if (err.code === 6) {
          console.log('>> Limite Api!')
          setTimeout(() => {
            return doSync(variacoes, queue)
          }, 1 * 60 * 1000)
        } else {
          if (err.response) {
            const { data } = response
            logger.error('UnexpectedErrVariation', JSON.stringify(data))
          }
          queue++
          doSync(variacoes, queue)
        }
      })
    }
  }

  const { variacoes } = produtoBody

  doSync(variacoes)
}

const getGtin = (produto) => {
  if (produto.gtin !== '' && produto.gtin !== 'SEM GTIN') {
    const { gtin } = produto
    return gtin
  }

  return undefined
}

const getSku = produto => {
  if (!produto.codigo || produto.codigo === '' || produto.codigo.length <= 2) {
    return undefined
  } else {
    return produto.codigo
  }
}
